import type { ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AdvertiserGuard } from '../auth/advertiser.guard';
import type { ModeratorGuard } from '../auth/moderator.guard';
import { DAY_MS } from '../orders/deadline';
import { advertiserAccess } from './advertiser-access';
import { parseApplication } from './advertiser-input';

const NOW = Date.UTC(2026, 10, 3);
const none = { advertiserAt: null, advertiserClosedAt: null };
const ago = (days: number) => new Date(NOW - days * DAY_MS);

describe('advertiserAccess', () => {
  it('кабинет открыт / закрыт — по пользователю, заявки не важны', () => {
    const pending = { status: 'PENDING' as const, decidedAt: null };
    expect(
      advertiserAccess({ ...none, advertiserAt: ago(1) }, pending, false, NOW)
        .state,
    ).toBe('open');
    expect(
      advertiserAccess(
        { ...none, advertiserClosedAt: ago(1) },
        null,
        false,
        NOW,
      ).state,
    ).toBe('closed');
    expect(advertiserAccess(none, null, true, NOW).state).toBe('open');
  });

  it('отказ — повтор через 7 дней, потом снова можно', () => {
    const rejected = (days: number) => ({
      status: 'REJECTED' as const,
      decidedAt: ago(days),
    });
    expect(advertiserAccess(none, rejected(2), false, NOW)).toEqual({
      state: 'rejected',
      retryAt: new Date(ago(2).getTime() + 7 * DAY_MS),
    });
    expect(advertiserAccess(none, rejected(7), false, NOW).state).toBe('none');
    expect(advertiserAccess(none, null, false, NOW).state).toBe('none');
    expect(
      advertiserAccess(none, { status: 'PENDING', decidedAt: null }, false, NOW)
        .state,
    ).toBe('pending');
  });
});

describe('parseApplication', () => {
  it('почта обязательна, телефон по желанию и без пробелов', () => {
    expect(
      parseApplication({ email: ' a@b.co ', phone: '+7 (900) 123-45-67' }),
    ).toEqual({ email: 'a@b.co', phone: '+79001234567' });
    expect(parseApplication({ email: 'a@b.co', phone: '' }).phone).toBeNull();
    expect(() => parseApplication({ email: 'abc' })).toThrow();
    expect(() => parseApplication({})).toThrow();
    expect(() => parseApplication({ email: 'a@b.co', phone: '12' })).toThrow();
  });
});

describe('AdvertiserGuard', () => {
  const guard = (moderator: boolean) =>
    new AdvertiserGuard({
      isModerator: () => moderator,
    } as unknown as ModeratorGuard);
  const ctx = (user: Partial<User>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { ...none, ...user } }),
      }),
    }) as unknown as ExecutionContext;

  it('заказы создаёт только открытый кабинет или модератор', () => {
    expect(guard(false).canActivate(ctx({ advertiserAt: ago(1) }))).toBe(true);
    expect(guard(true).canActivate(ctx({}))).toBe(true);
    expect(() => guard(false).canActivate(ctx({}))).toThrow();
    expect(() =>
      guard(false).canActivate(ctx({ advertiserClosedAt: ago(1) })),
    ).toThrow();
  });
});
