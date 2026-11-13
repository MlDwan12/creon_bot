import type { ConfigService } from '@nestjs/config';
import { ModeratorGuard } from '../auth/moderator.guard';
import { PayoutsService } from '../payouts/payouts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdvertisersService } from '../advertisers/advertisers.service';
import { ErasureService } from './erasure.service';

/** Удаление личных данных по запросу — на настоящем Postgres. Запуск — `yarn test:int`. */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const erasure = new ErasureService(
  prisma,
  new PayoutsService(prisma),
  new ModeratorGuard({
    get: (key: string) => (key === 'MODERATOR_IDS' ? '1' : undefined),
  } as unknown as ConfigService),
);

const advertisers = new AdvertisersService(prisma);

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Notification", "Payout", "Submission", "Order", "SocialAccount", "AdvertiserApplication", "LinkVerification", "WebLogin", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

/** Креатор с данными и выведенными деньгами: долгов перед ним нет. */
async function creatorWithData() {
  const advertiser = await prisma.user.create({ data: { telegramId: 50n } });
  const user = await prisma.user.create({
    data: {
      telegramId: 777n,
      username: 'anya',
      firstName: 'Аня',
      socialLinks: ['https://www.tiktok.com/@anya'],
      payoutWallet: 'TXy4aaaaaaaaaaaaaaaaaaaaaaaaaa9fQe',
    },
  });
  const order = await prisma.order.create({
    data: {
      advertiserId: advertiser.id,
      title: 't',
      description: 'd',
      budgetMinor: 10000,
      feePercent: 10,
      status: 'CLOSED',
    },
  });
  await prisma.submission.create({
    data: {
      orderId: order.id,
      creatorId: user.id,
      status: 'MODERATOR_APPROVED',
      videoUrl: 'https://www.tiktok.com/@anya/video/1',
      payoutMinor: 1500,
      decidedAt: new Date(Date.now() - 10 * 86_400_000),
      finalizedAt: new Date(),
    },
  });
  await prisma.payout.create({
    data: {
      creatorId: user.id,
      amountMinor: 1500,
      wallet: user.payoutWallet,
      status: 'PAID',
    },
  });
  await prisma.socialAccount.create({
    data: {
      userId: user.id,
      platform: 'TIKTOK',
      externalId: 'x1',
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: new Date(),
    },
  });
  await prisma.advertiserApplication.create({
    data: { userId: user.id, email: 'a@b.co', phone: '+79001234567' },
  });
  await prisma.notification.create({
    data: { chatId: 777n, text: 'привет', path: '/' },
  });
  return user;
}

it('стирает личные данные, заказы и выплаты остаются без привязки к человеку', async () => {
  const user = await creatorWithData();
  await prisma.user.update({
    where: { id: user.id },
    data: { advertiserAt: new Date() },
  });
  await erasure.erase(user.id);

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(after).toMatchObject({
    telegramId: BigInt(-user.id),
    username: null,
    firstName: null,
    socialLinks: [],
    payoutWallet: null,
  });
  expect(after.erasedAt).not.toBeNull();
  // кабинет заказчика закрыт, и модератор его больше не откроет
  expect(after.advertiserAt).toBeNull();
  expect(after.advertiserClosedAt).not.toBeNull();
  await expect(advertisers.open(user.id, 1n)).rejects.toThrow(
    'данные пользователя удалены',
  );
  expect(await prisma.socialAccount.count()).toBe(0);
  expect(await prisma.advertiserApplication.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  const payout = await prisma.payout.findFirstOrThrow();
  expect(payout).toMatchObject({ amountMinor: 1500, wallet: null });
  expect(await prisma.submission.count()).toBe(1);

  await expect(erasure.erase(user.id)).rejects.toThrow('уже удалены');
});

it('не удаляет, пока ему должны деньги или идут дела; модератора — никогда', async () => {
  const user = await creatorWithData();
  // выплату ещё не провели — деньги к выводу
  await prisma.payout.updateMany({ data: { status: 'REJECTED' } });
  await expect(erasure.erase(user.id)).rejects.toThrow('деньги к выводу');

  const moderator = await prisma.user.create({ data: { telegramId: 1n } });
  await expect(erasure.erase(moderator.id)).rejects.toThrow('модератора');
  expect(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).erasedAt,
  ).toBeNull();
});
