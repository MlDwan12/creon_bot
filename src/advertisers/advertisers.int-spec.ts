import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdvertisersService } from './advertisers.service';

/** Заявка в заказчики: двойной тап, два модератора на одной заявке, закрытие кабинета. */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const advertisers = new AdvertisersService(prisma);
const input = { email: 'a@b.co', phone: null };

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "AdvertiserApplication", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

it('двойной тап — одна заявка; два модератора — одно решение', async () => {
  const user = await prisma.user.create({ data: { telegramId: 1n } });
  const sent = await Promise.allSettled([
    advertisers.apply(user, false, input),
    advertisers.apply(user, false, input),
  ]);
  expect(sent.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const [app] = await advertisers.listPending();

  const decided = await Promise.allSettled([
    advertisers.approve(app.id, 10n),
    advertisers.reject(app.id, 11n, 'нет'),
  ]);
  expect(decided.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const after = await prisma.advertiserApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  // кабинет открыт ровно тогда, когда выиграло одобрение
  expect(fresh.advertiserAt !== null).toBe(after.status === 'APPROVED');
});

it('отказ — повтор только через неделю; закрытый кабинет — без новой заявки', async () => {
  const user = await prisma.user.create({ data: { telegramId: 2n } });
  const app = await advertisers.apply(user, false, input);
  await advertisers.reject(app.id, 10n, 'рано');
  expect((await advertisers.access(user, false)).state).toBe('rejected');
  await expect(advertisers.apply(user, false, input)).rejects.toThrow();

  const opened = await advertisers.open(user.id, 10n);
  expect((await advertisers.access(opened, false)).state).toBe('open');
  const closed = await advertisers.close(user.id);
  expect((await advertisers.access(closed, false)).state).toBe('closed');
  await expect(advertisers.apply(closed, false, input)).rejects.toThrow();
  await expect(advertisers.close(user.id)).rejects.toThrow();
});
