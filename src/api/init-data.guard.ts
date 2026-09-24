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
import { UsersService } from '../users/users.service';
import { validateInitData } from './init-data.util';

// ponytail: initData не обновляется, пока Mini App открыт, поэтому срок щедрый.
// Если понадобится короче — выдавать свою сессию/JWT при входе.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export type ApiRequest = Request & { user: User };

/**
 * Заказ и отклик — только с @username: иначе второй стороне не с кем связаться.
 * initData фиксируется при запуске Mini App, поэтому после настройки username его надо перезапустить.
 */
export function requireUsername(user: User) {
  if (!user.username)
    throw new ForbiddenException(
      'Чтобы с вами могли связаться, укажите имя пользователя (username) в настройках Telegram и откройте приложение заново',
    );
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

    req.user = await this.usersService.findOrCreate({
      telegramId: BigInt(tgUser.id),
      username: tgUser.username,
      firstName: tgUser.first_name,
    });
    return true;
  }
}
