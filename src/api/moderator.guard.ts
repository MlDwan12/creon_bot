import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { parseModeratorIds } from '../bot/utils/moderator.util';
import type { ApiRequest } from './init-data.guard';

/**
 * Доступ только модераторам из MODERATOR_IDS.
 * Ставится после InitDataGuard: пользователь к этому моменту уже проверен и лежит в req.user.
 */
@Injectable()
export class ModeratorGuard implements CanActivate {
  private readonly moderatorIds: Set<string>;

  constructor(config: ConfigService) {
    this.moderatorIds = parseModeratorIds(config.get<string>('MODERATOR_IDS'));
  }

  isModerator(user: User): boolean {
    return this.moderatorIds.has(user.telegramId.toString());
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    if (!this.isModerator(req.user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}
