import type { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './api/analytics.service';
import { ProfilesService } from './api/profiles.service';
import { MAX_ACTIVE_ORDERS, OrdersService } from './orders/orders.service';
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
const analytics = new AnalyticsService(prisma);
const profiles = new ProfilesService(prisma);

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

describe('срок от публикации и напоминания', () => {
  it('срок сдвигается на время модерации', async () => {
    const advertiser = await user();
    const order = await pendingOrder(advertiser.id, new Date(Date.now() + DAY));
    // заказ провисел на модерации двое суток
    await prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - 2 * DAY) },
    });

    const published = await orders.moderatorApprove(order.id, 1n);

    const shiftedBy = published.deadline!.getTime() - order.deadline!.getTime();
    expect(shiftedBy).toBeGreaterThanOrEqual(2 * DAY);
    expect(shiftedBy).toBeLessThan(2 * DAY + 60_000);
  });

  it('о близком сроке напоминаем один раз, после продления — снова', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(
      advertiser.id,
      new Date(Date.now() + DAY / 2),
    );
    await submissions.claim(order.id, creator.id);

    expect(await orders.listDeadlineSoon()).toEqual([{ id: order.id }]);
    const reminded = await orders.markDeadlineReminded(order.id);
    expect(reminded?.submissions.map((s) => s.creator.id)).toEqual([
      creator.id,
    ]);
    expect(await orders.markDeadlineReminded(order.id)).toBeNull();
    expect(await orders.listDeadlineSoon()).toEqual([]);

    // +1 день к оставшимся 12 ч — снова меньше суток до срока, и напоминание сброшено
    await orders.extend(order.id, advertiser.id, 1);
    expect(await orders.listDeadlineSoon()).toEqual([]);
    await prisma.order.update({
      where: { id: order.id },
      data: { deadline: new Date(Date.now() + DAY / 2) },
    });
    expect(await orders.listDeadlineSoon()).toEqual([{ id: order.id }]);
  });
});

describe('лимит активных заказов', () => {
  it('больше MAX_ACTIVE_ORDERS на модерации и открытых — нельзя, закрытые не считаются', async () => {
    const advertiser = await user();
    const created: { id: number }[] = [];
    for (let i = 0; i < MAX_ACTIVE_ORDERS; i++)
      created.push(await pendingOrder(advertiser.id));
    await expect(pendingOrder(advertiser.id)).rejects.toThrow(
      'активных заказов',
    );

    const first = await orders.moderatorApprove(created[0].id, 1n);
    await orders.close(first.id, advertiser.id);
    await expect(pendingOrder(advertiser.id)).resolves.toBeDefined();
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

describe('воронка', () => {
  it('считает заказы, видео, пользователей и оборот за период', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const accepted = await orders.create(advertiser.id, {
      title: 'Заказ',
      description: 'Описание',
      category: 'OTHER',
      priceKopecks: 300_000,
    });
    await orders.moderatorApprove(accepted.id, 1n);
    const s = await submissions.claim(accepted.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');
    await submissions.moderatorApprove(s.id, 1n);
    await submissions.advertiserApprove(s.id, advertiser.id, {
      rating: 5,
      review: null,
      portfolioAllowed: false,
    });

    const rejected = await pendingOrder(advertiser.id);
    await orders.moderatorReject(rejected.id, 1n, 'причина');
    await pendingOrder(advertiser.id);

    expect(await analytics.funnel()).toMatchObject({
      orders: {
        created: 3,
        published: 1,
        rejected: 1,
        withClaims: 1,
        withVideos: 1,
        withAccepted: 1,
      },
      videos: { submitted: 1, accepted: 1, pending: 0 },
      users: { new: 2, activeAdvertisers: 1, activeCreators: 1 },
      turnover: { rubles: 3000, acceptedPriced: 1 },
    });
    expect((await analytics.funnel()).orders.moderationHours).toBe(0);

    // период, в который ничего не попало
    const future = await analytics.funnel(new Date(Date.now() + DAY));
    expect(future.orders.created).toBe(0);
    expect(future.turnover.rubles).toBe(0);
    expect(future.orders.moderationHours).toBeNull();
  });
});

describe('профиль креатора', () => {
  /** Видео креатора доходит до рекламодателя (одобрено модератором) и принимается с оценкой. */
  async function acceptedVideo(
    advertiserId: number,
    creatorId: number,
    rating: number,
    portfolioAllowed = false,
  ) {
    const order = await openOrder(advertiserId);
    const s = await submissions.claim(order.id, creatorId);
    await submissions.attachVideo(s.id, creatorId, `https://v.example/${s.id}`);
    await submissions.moderatorApprove(s.id, 1n);
    await submissions.advertiserApprove(s.id, advertiserId, {
      rating,
      review: `отзыв ${rating}`,
      portfolioAllowed,
    });
    return s;
  }

  it('рейтинг, выполненные заказы, отзывы и портфолио только с согласия', async () => {
    const [advertiser, creator] = [await user(), await user()];
    await acceptedVideo(advertiser.id, creator.id, 5, true);
    await acceptedVideo(advertiser.id, creator.id, 4);

    const profile = await profiles.profile(creator.id);

    expect(profile).toMatchObject({
      rating: 4.5,
      reviewsCount: 2,
      completed: 2,
    });
    expect(profile.reviews.map((r) => r.rating).sort()).toEqual([4, 5]);
    expect(profile.portfolio).toHaveLength(1);
  });

  it('видят сам креатор, модератор и рекламодатель, до которого дошло его видео', async () => {
    const [advertiser, creator, stranger] = [
      await user(),
      await user(),
      await user(),
    ];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');

    // видео ещё у модератора — рекламодатель его не видел
    expect(await profiles.canView(advertiser, creator.id, false)).toBe(false);
    await submissions.moderatorApprove(s.id, 1n);
    expect(await profiles.canView(advertiser, creator.id, false)).toBe(true);

    expect(await profiles.canView(creator, creator.id, false)).toBe(true);
    expect(await profiles.canView(stranger, creator.id, true)).toBe(true);
    expect(await profiles.canView(stranger, creator.id, false)).toBe(false);
  });

  it('модератор удаляет отзыв — приёмка и счётчик выполненных остаются', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const s = await acceptedVideo(advertiser.id, creator.id, 1);

    await submissions.removeReview(s.id);

    const profile = await profiles.profile(creator.id);
    expect(profile).toMatchObject({
      rating: null,
      reviewsCount: 0,
      completed: 1,
    });
    await expect(submissions.removeReview(s.id)).rejects.toThrow('не найден');
  });

  it('статистика рекламодателя: принятые и отклонённые видео', async () => {
    const [advertiser, creator] = [await user(), await user()];
    await acceptedVideo(advertiser.id, creator.id, 5);
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/2');
    await submissions.moderatorApprove(s.id, 1n);
    await submissions.advertiserReject(s.id, advertiser.id, 'не то');

    expect(await submissions.advertiserStats(advertiser.id)).toEqual({
      accepted: 1,
      rejected: 1,
    });
  });
});
