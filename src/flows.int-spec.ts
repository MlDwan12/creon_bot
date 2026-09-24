import type { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders/orders.service';
import { PrismaService } from './prisma/prisma.service';
import { SubmissionsService } from './submissions/submissions.service';

/**
 * Интеграционные тесты сервисов на настоящем Postgres: статусы, гонки и права, которые держатся
 * на условиях в SQL (updateMany/deleteMany с where, Serializable-транзакция). Запуск — `yarn test:int`.
 */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test')) {
  // Каждый тест очищает таблицы — на dev-базе это стёрло бы данные.
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
}

const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const orders = new OrdersService(prisma);
const submissions = new SubmissionsService(prisma);

const DAY = 24 * 60 * 60 * 1000;
let nextTelegramId = 1n;

function user() {
  const telegramId = nextTelegramId++;
  return prisma.user.create({
    data: { telegramId, username: `user${telegramId}` },
  });
}

async function pendingOrder(advertiserId: number, deadline?: Date) {
  return orders.create(advertiserId, {
    title: 'Заказ',
    description: 'Описание',
    category: 'OTHER',
    deadline,
  });
}

async function openOrder(advertiserId: number, deadline?: Date) {
  const order = await pendingOrder(advertiserId, deadline);
  return orders.moderatorApprove(order.id, 1n);
}

const statusOf = async (orderId: number) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Submission", "Order", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

describe('отклик', () => {
  it('на свой заказ — нельзя', async () => {
    const advertiser = await user();
    const order = await openOrder(advertiser.id);
    await expect(submissions.claim(order.id, advertiser.id)).rejects.toThrow(
      'свой заказ',
    );
  });

  it('второй отклик «в работе» — нельзя, после отправки видео — можно', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);

    const first = await submissions.claim(order.id, creator.id);
    await expect(submissions.claim(order.id, creator.id)).rejects.toThrow(
      'в работе',
    );

    await submissions.attachVideo(first.id, creator.id, 'https://v.example/1');
    await expect(
      submissions.claim(order.id, creator.id),
    ).resolves.toBeDefined();
  });

  it('двойной тап создаёт один отклик', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);

    const results = await Promise.allSettled([
      submissions.claim(order.id, creator.id),
      submissions.claim(order.id, creator.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.submission.count()).toBe(1);
  });
});

describe('срок заказа', () => {
  it('просроченный закрывается, видео по нему больше не принимаются', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id, new Date(Date.now() - DAY));
    const inProgress = await submissions.claim(order.id, creator.id);

    expect(await orders.listOverdue()).toEqual([{ id: order.id }]);
    const expired = await orders.expire(order.id);
    // креатор с откликом «в работе» — среди тех, кого уведомим
    expect(expired?.submissions.map((s) => s.creator.id)).toEqual([creator.id]);
    expect(await statusOf(order.id)).toBe('EXPIRED');
    expect(await orders.listOverdue()).toEqual([]);

    await expect(
      submissions.attachVideo(inProgress.id, creator.id, 'https://v.example/1'),
    ).rejects.toThrow('Срок');
  });

  it('продление открывает истёкший заказ, и старый срок его уже не закроет', async () => {
    const advertiser = await user();
    const order = await openOrder(advertiser.id, new Date(Date.now() - DAY));
    await orders.expire(order.id);

    await orders.extend(order.id, advertiser.id, 7);

    const reopened = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.closedAt).toBeNull();
    expect(reopened.deadline!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(await orders.expire(order.id)).toBeNull();
  });

  it('закрытый вручную не продлевается, но начатое видео по нему принимается', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id, new Date(Date.now() + DAY));
    const inProgress = await submissions.claim(order.id, creator.id);
    await orders.close(order.id, advertiser.id);

    await expect(orders.extend(order.id, advertiser.id, 7)).rejects.toThrow(
      'Продлить',
    );
    await expect(
      submissions.attachVideo(inProgress.id, creator.id, 'https://v.example/1'),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
  });

  it('продлить может только рекламодатель заказа', async () => {
    const [advertiser, stranger] = [await user(), await user()];
    const order = await openOrder(advertiser.id, new Date(Date.now() + DAY));
    await expect(orders.extend(order.id, stranger.id, 7)).rejects.toThrow(
      'не ваш',
    );
  });
});

describe('удаление заказа', () => {
  it('можно, пока никто не сдал видео — отклики «в работе» удаляются вместе с ним', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    await submissions.claim(order.id, creator.id);

    await orders.remove(order.id, advertiser.id);

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.submission.count()).toBe(0);
  });

  it('нельзя, если по заказу уже сдавали видео', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');

    await expect(orders.remove(order.id, advertiser.id)).rejects.toThrow(
      'удалить его нельзя',
    );
    expect(await prisma.order.count()).toBe(1);
  });
});

describe('модерация', () => {
  it('два модератора на одном заказе — решение принимает только первый', async () => {
    const advertiser = await user();
    const order = await pendingOrder(advertiser.id);

    const results = await Promise.allSettled([
      orders.moderatorApprove(order.id, 1n),
      orders.moderatorReject(order.id, 2n, 'причина'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(['OPEN', 'REJECTED']).toContain(await statusOf(order.id));
  });
});
