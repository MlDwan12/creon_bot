import {
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
import { SocialPlatform } from '@prisma/client';
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
    throw new NotFoundException('Нет такой площадки');
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
    try {
      const { user, name } = await this.accounts.complete(
        parsePlatform(platform),
        query,
      );
      this.notifications.socialAccountConnected(user, name);
      res
        .type('html')
        .send(page(`${name} подключён`, 'Можно вернуться в Telegram.'));
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const message =
        err instanceof HttpException
          ? err.message
          : 'Что-то пошло не так — попробуйте позже';
      res
        .status(status)
        .type('html')
        .send(page('Не получилось подключить', message));
    }
  }
}

function page(title: string, text: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.4rem">${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></body></html>`;
}
