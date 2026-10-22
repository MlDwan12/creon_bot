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

// ponytail: initData не обновляется, пока Mini App открыт, поэтому срок щедрый.
// Если понадобится короче — выдавать свою сессию/JWT при входе.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/** `authDate` — когда Telegram выдал initData (Unix-секунды, из проверенной подписи). */
export type ApiRequest = Request & { user: User; authDate: number };

/** Вход для смены кошелька и вывода — не старше часа: украденный initData живёт сутки. */
const FRESH_LOGIN_SECONDS = 60 * 60;

/**
 * Деньги уходят наружу (кошелёк, вывод) — только со свежего входа: initData живёт сутки, и
 * утёкший заголовок (скриншот, лог, прокси) иначе сутки давал бы сменить кошелёк и вывести всё.
 * Мини-апп, открытый дольше часа, достаточно переоткрыть.
 */
export function assertFreshLogin(req: ApiRequest) {
  if (Date.now() / 1000 - req.authDate > FRESH_LOGIN_SECONDS)
    throw new ForbiddenException(tr('errors.reopenApp'));
}

/**
 * Авторизация Mini App: заголовок `Authorization: tma <initData>`.
 * Пользователь берётся только из проверенной подписи — никогда из тела/параметров запроса.
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
    const [scheme, raw] = (req.headers.authorization ?? '').split(' ');
    const tgUser =
      scheme === 'tma' && raw
        ? validateInitData(
            raw,
            this.config.get<string>('BOT_TOKEN')!,
            INIT_DATA_MAX_AGE_SECONDS,
          )
        : null;
    if (!tgUser) throw new UnauthorizedException();
    req.authDate = Number(new URLSearchParams(raw).get('auth_date'));

    req.user = await this.usersService.findOrCreate({
      telegramId: BigInt(tgUser.id),
      username: tgUser.username,
      firstName: tgUser.first_name,
      telegramLanguage: tgUser.language_code,
    });
    setRequestLang(userLang(req.user));
    // `banned` — мини-апп по нему показывает экран блокировки вместо любого экрана.
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
}
