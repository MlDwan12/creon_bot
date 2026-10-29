import { userLang } from '../i18n/i18n';
import { setRequestLang, tr } from '../i18n/request-lang';
import {
  CanActivate,
  ForbiddenException,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { SupportService } from '../support/support.service';
import { UsersService } from '../users/users.service';
import { validateInitData } from './init-data.util';
import { readCookie, SESSION_COOKIE, verifySession } from './web-login.util';

// ponytail: initData не обновляется, пока Mini App открыт, поэтому срок щедрый.
// Если понадобится короче — выдавать свою сессию/JWT при входе.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * `authDate` — когда Telegram выдал initData или подтвердил вход на сайт (Unix-секунды, из проверенной
 * подписи); `web` — запрос с сайта (cookie сессии), а не из мини-аппа.
 */
export type ApiRequest = Request & {
  user: User;
  authDate: number;
  web?: boolean;
};

/** Вход для смены кошелька и вывода — не старше часа: украденный initData живёт сутки, сессия сайта — месяц. */
const FRESH_LOGIN_SECONDS = 60 * 60;

/**
 * Деньги уходят наружу (кошелёк, вывод) — только со свежего входа: initData живёт сутки, и
 * утёкший заголовок (скриншот, лог, прокси) иначе сутки давал бы сменить кошелёк и вывести всё.
 * Мини-апп, открытый дольше часа, достаточно переоткрыть, на сайте — войти заново (`relogin` — сайт
 * по нему предлагает кнопку входа).
 */
export function assertFreshLogin(req: ApiRequest) {
  if (Date.now() / 1000 - req.authDate <= FRESH_LOGIN_SECONDS) return;
  throw new ForbiddenException(
    req.web
      ? { message: tr('errors.relogin'), relogin: true }
      : tr('errors.reopenApp'),
  );
}

/**
 * Авторизация API. Mini App — заголовок `Authorization: tma <initData>`; сайт — cookie сессии после
 * входа через Telegram Login Widget (WebAuthController). Пользователь берётся только из проверенной
 * подписи — никогда из тела/параметров запроса.
 */
@Injectable()
export class InitDataGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly support: SupportService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const user = (await this.miniAppUser(req)) ?? (await this.webUser(req));
    if (!user) throw new UnauthorizedException();
    req.user = user;
    setRequestLang(userLang(req.user));
    // `banned` — мини-апп по нему показывает экран блокировки вместо любого экрана.
    // полный бан — ни причины, ни поддержки
    if (req.user.bannedAt && req.user.banFinal)
      throw new ForbiddenException({
        message: tr('errors.banned'),
        banned: true,
        final: true,
      });
    if (req.user.bannedAt)
      throw new ForbiddenException({
        message: tr('errors.banned'),
        banned: true,
        reason: req.user.banReason,
        // /api/me заблокированному недоступен — ссылку на поддержку отдаём прямо здесь
        supportUrl: await this.support.url(),
      });
    return true;
  }

  private async miniAppUser(req: ApiRequest): Promise<User | null> {
    const [scheme, raw] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'tma' || !raw) return null;
    const tgUser = validateInitData(
      raw,
      this.config.get<string>('BOT_TOKEN')!,
      INIT_DATA_MAX_AGE_SECONDS,
    );
    if (!tgUser) return null;
    req.authDate = Number(new URLSearchParams(raw).get('auth_date'));
    return this.usersService.findOrCreate({
      telegramId: BigInt(tgUser.id),
      username: tgUser.username,
      firstName: tgUser.first_name,
      telegramLanguage: tgUser.language_code,
    });
  }

  private async webUser(req: ApiRequest): Promise<User | null> {
    // Свой заголовок — защита от CSRF: чужая страница может послать его только после разрешения
    // CORS, а API его не даёт. Без заголовка cookie не считается (её браузер шлёт сам).
    if (req.headers['x-fixum-web'] !== '1') return null;
    const session = verifySession(
      readCookie(req.headers.cookie, SESSION_COOKIE),
      this.config.get<string>('BOT_TOKEN')!,
    );
    if (!session) return null;
    req.authDate = session.authDate;
    req.web = true;
    return this.usersService.findById(session.userId);
  }
}
