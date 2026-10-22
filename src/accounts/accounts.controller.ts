import { userLang } from '../i18n/i18n';
import { requestLang, setRequestLang, tr } from '../i18n/request-lang';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SocialPlatform, type User } from '@prisma/client';
import type { Response } from 'express';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { escapeHtml } from '../common/format';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NotificationsService } from '../telegram/notifications.service';
import { AccountsService } from './accounts.service';

/** tiktok / vk / instagram в адресе → площадка; другое — 404. */
function parsePlatform(raw: string): SocialPlatform {
  const platform = raw.toUpperCase() as SocialPlatform;
  if (!Object.values(SocialPlatform).includes(platform))
    throw new NotFoundException(tr('errors.noPlatform'));
  return platform;
}

/** Подключение аккаунтов площадок из профиля креатора. */
@Controller('api/accounts')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Площадки, которые можно подключить, и подключённые аккаунты. Пусто — ни одна не включена. */
  @Get()
  list(@Req() req: ApiRequest) {
    return this.accounts.list(req.user.id);
  }

  /** Ссылка на вход на площадке — мини-апп открывает её во внешнем браузере. */
  @Post(':platform/connect')
  async connect(@Param('platform') platform: string, @Req() req: ApiRequest) {
    return {
      url: await this.accounts.start(req.user.id, parsePlatform(platform)),
    };
  }

  @Delete(':id')
  async disconnect(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    await this.accounts.disconnect(req.user.id, id);
    return { ok: true };
  }
}

/**
 * Сюда площадка возвращает креатора после входа (адрес регистрируется в настройках приложения
 * на площадке: <WEBAPP_URL>/oauth/<tiktok|vk|instagram>/callback). Без авторизации мини-аппа — креатор пришёл
 * из браузера; кто он, говорит одноразовый state. Ответ — простая страница без скриптов (так требует VK ID).
 */
@Controller('oauth')
export class OAuthCallbackController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get(':platform/callback')
  async callback(
    @Param('platform') platform: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    await this.respond(res, async () => {
      const p = parsePlatform(platform);
      const { user, name, label, code } = await this.accounts.complete(
        p,
        query,
      );
      // страница — на языке пользователя, а не только браузера: теперь мы знаем, кто это
      setRequestLang(userLang(user));
      return confirmPage(p, code, {
        title: tr('errors.oauthConfirmTitle', { platform: name }),
        // кто вошёл, видит, к чьему профилю Fixum подключает: чужое имя — повод нажать «Это не я»
        text: tr('errors.oauthConfirmText', {
          platform: name,
          account: label ?? name,
          profile: profileLabel(user),
        }),
      });
    });
  }

  /** Кнопки страницы возврата: `action=connect` — подключить, иначе — «Это не я». */
  @Post(':platform/confirm')
  async confirm(
    @Param('platform') platform: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    await this.respond(res, async () => {
      const code = typeof body?.code === 'string' ? body.code : '';
      if (body?.action !== 'connect') {
        await this.accounts.decline(code);
        return page(
          tr('errors.oauthDeclinedTitle'),
          tr('errors.oauthDeclinedText'),
        );
      }
      const { user, name } = await this.accounts.confirm(
        parsePlatform(platform),
        code,
      );
      this.notifications.socialAccountConnected(user, name);
      setRequestLang(userLang(user));
      return page(
        tr('errors.oauthConnected', { platform: name }),
        tr('errors.oauthBackToTelegram'),
      );
    });
  }

  private async respond(res: Response, build: () => Promise<string>) {
    try {
      res.type('html').send(await build());
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const message =
        err instanceof HttpException ? err.message : tr('errors.oauthUnknown');
      res
        .status(status)
        .type('html')
        .send(page(tr('errors.oauthFailedTitle'), message));
    }
  }
}

/**
 * Чей профиль Fixum на странице подтверждения. Имя в Telegram — свободный текст: «@victim» в имени
 * не должен выглядеть как настоящий @victim, иначе пересланная ссылка подключит чужой аккаунт.
 */
function profileLabel(user: User) {
  return user.username
    ? `@${user.username}`
    : tr('errors.oauthProfileNoUsername', {
        name: user.firstName ?? `id${user.telegramId}`,
      });
}

function page(title: string, text: string, extra = '') {
  return `<!doctype html><html lang="${requestLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.4rem">${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${extra}</body></html>`;
}

/** Подтверждение подключения: форма без скриптов (так требует VK ID), код — одноразовый. */
function confirmPage(
  platform: SocialPlatform,
  code: string,
  { title, text }: { title: string; text: string },
) {
  const button = (action: string, label: string, primary: boolean) =>
    `<button type="submit" name="action" value="${action}" style="font-size:1rem;padding:.7rem 1.2rem;margin:.3rem;border-radius:.6rem;border:1px solid #888;${primary ? 'background:#2b7cff;color:#fff;border-color:#2b7cff' : 'background:none'}">${escapeHtml(label)}</button>`;
  return page(
    title,
    text,
    `<form method="post" action="/oauth/${platform.toLowerCase()}/confirm"><input type="hidden" name="code" value="${escapeHtml(code)}">${button('connect', tr('errors.oauthConfirmYes'), true)}${button('decline', tr('errors.oauthConfirmNo'), false)}</form>`,
  );
}
