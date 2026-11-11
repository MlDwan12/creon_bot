import { AdvertiserApplicationStatus } from '@prisma/client';
import type { AdvertiserApplication, User } from '@prisma/client';
import { DAY_MS } from '../orders/deadline';

/** Через сколько дней после отказа можно подать заявку снова. */
export const ADVERTISER_RETRY_DAYS = 7;

/** Кабинет заказчика: open — всё можно; closed — модератор закрыл, свои заказы только смотреть; null — нет. */
export type AdvertiserCabinet = 'open' | 'closed' | null;

/** Считается по строке пользователя, без запросов: им пользуются AdvertiserGuard и /api/me. */
export function advertiserCabinet(
  user: Pick<User, 'advertiserAt' | 'advertiserClosedAt'>,
  isModerator: boolean,
): AdvertiserCabinet {
  if (isModerator || user.advertiserAt) return 'open';
  return user.advertiserClosedAt ? 'closed' : null;
}

/**
 * Что показать на месте кнопки «Стать заказчиком»: open/closed — кабинет (closed — без повторной
 * заявки, только через поддержку); pending — заявка на рассмотрении; rejected — отказ, повтор с
 * `retryAt`; none — можно подать заявку.
 */
export type AdvertiserAccess = {
  state: 'open' | 'closed' | 'pending' | 'rejected' | 'none';
  retryAt: Date | null;
};

export function advertiserAccess(
  user: Pick<User, 'advertiserAt' | 'advertiserClosedAt'>,
  last: Pick<AdvertiserApplication, 'status' | 'decidedAt'> | null,
  isModerator: boolean,
  now = Date.now(),
): AdvertiserAccess {
  const cabinet = advertiserCabinet(user, isModerator);
  if (cabinet) return { state: cabinet, retryAt: null };
  if (last?.status === AdvertiserApplicationStatus.PENDING)
    return { state: 'pending', retryAt: null };
  if (last?.status === AdvertiserApplicationStatus.REJECTED && last.decidedAt) {
    const retryAt = new Date(
      last.decidedAt.getTime() + ADVERTISER_RETRY_DAYS * DAY_MS,
    );
    if (retryAt.getTime() > now) return { state: 'rejected', retryAt };
  }
  return { state: 'none', retryAt: null };
}
