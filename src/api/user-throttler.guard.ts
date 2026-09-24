import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ApiRequest } from './init-data.guard';

/**
 * Лимиты считаем по пользователю, а не по IP: за прокси у всех был бы один IP.
 * Ставить после InitDataGuard — он кладёт в запрос проверенного `user`.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: ApiRequest): Promise<string> {
    return Promise.resolve(String(req.user.id));
  }
}
