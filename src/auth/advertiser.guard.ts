import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { advertiserCabinet } from '../advertisers/advertiser-access';
import { tr } from '../i18n/request-lang';
import type { ApiRequest } from './init-data.guard';
import { ModeratorGuard } from './moderator.guard';

/**
 * Создавать и править заказы — только с открытым кабинетом заказчика (User.advertiserAt) или
 * модератору. Закрытый кабинет — свои заказы только смотреть (чтение этим не закрыто).
 * Ставится после InitDataGuard.
 */
@Injectable()
export class AdvertiserGuard implements CanActivate {
  constructor(private readonly moderatorGuard: ModeratorGuard) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const cabinet = advertiserCabinet(
      req.user,
      this.moderatorGuard.isModerator(req.user),
    );
    if (cabinet === 'open') return true;
    throw new ForbiddenException(
      tr(
        cabinet === 'closed' ? 'errors.cabinetClosed' : 'errors.notAdvertiser',
      ),
    );
  }
}
