import type { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './api/analytics.service';
import { BansService } from './api/bans.service';
import { ProfilesService } from './api/profiles.service';
import { ReportsService } from './api/reports.service';
import { MAX_ACTIVE_ORDERS, OrdersService } from './orders/orders.service';
import { PrismaService } from './prisma/prisma.service';
import { SubmissionsService } from './submissions/submissions.service';
import { UsersService } from './users/users.service';

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
const bans = new BansService(prisma);
const profiles = new ProfilesService(prisma);
const reports = new ReportsService(prisma, orders, profiles);
const users = new UsersService(prisma);

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

/** Решение модератора по текущей версии заказа — той, что он открыл бы в мини-аппе. */
const versionOf = async (orderId: number) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
    .moderationRequestedAt;
const approveOrder = async (orderId: number, mod: bigint) =>
  orders.moderatorApprove(orderId, mod, await versionOf(orderId));
const rejectOrder = async (orderId: number, mod: bigint, comment: string) =>
  orders.moderatorReject(orderId, mod, comment, await versionOf(orderId));

async function openOrder(advertiserId: number, deadline?: Date) {
  const order = await pendingOrder(advertiserId, deadline);
  return approveOrder(order.id, 1n);
}

const statusOf = async (orderId: number) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Report", "Submission", "Order", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

describe('пользователь из initData', () => {
  it('убрал username в Telegram — он стирается и в базе', async () => {
    await users.findOrCreate({
      telegramId: 500n,
      username: 'old_nick',
      firstName: 'Аня',
    });
    const updated = await users.findOrCreate({
      telegramId: 500n,
      firstName: 'Аня',
    });
    expect(updated.username).toBeNull();
  });
});

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
      data: { moderationRequestedAt: new Date(Date.now() - 2 * DAY) },
    });

    const published = await approveOrder(order.id, 1n);

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

describe('каталог', () => {
  it('hasMore — есть ли следующая страница; total — число открытых', async () => {
    const adv = await user();
    for (let i = 0; i < 3; i++) await openOrder(adv.id);
    await pendingOrder(adv.id); // на модерации — не в каталоге

    const first = await orders.listOpen(undefined, undefined, 2);
    expect(first).toMatchObject({ hasMore: true, total: 3 });
    expect(first.items).toHaveLength(2);

    const tail = first.items[1];
    const last = await orders.listOpen(undefined, tail, 2);
    expect(last.hasMore).toBe(false);
    expect(last.items).toHaveLength(1);
  });

  it('закрытый заказ, пока листали, не сдвигает следующую страницу', async () => {
    const adv = await user();
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await openOrder(adv.id)).id);
    const first = await orders.listOpen(undefined, undefined, 2); // новые: ids[3], ids[2]
    await orders.close(first.items[0].id, adv.id); // закрыли уже показанный
    const next = await orders.listOpen(undefined, first.items[1], 2);
    expect(next.items.map((o) => o.id)).toEqual([ids[1], ids[0]]);
  });
});

describe('правка заказа', () => {
  const edit = {
    title: 'Новое название',
    description: 'Новое описание',
    priceKopecks: 50_000,
    category: 'FOOD' as const,
  };

  it('открытый — снова на проверку; работающие креаторы — в ответе для уведомления', async () => {
    const adv = await user();
    const creator = await user();
    const order = await openOrder(adv.id);
    await submissions.claim(order.id, creator.id);

    const updated = await orders.update(order.id, adv.id, edit);
    expect(updated).toMatchObject({
      ...edit,
      status: 'PENDING_MODERATION',
      decidedAt: null,
    });
    expect(updated.submissions.map((s) => s.creatorId)).toEqual([creator.id]);
  });

  it('чужой и закрытый — нельзя', async () => {
    const adv = await user();
    const other = await user();
    const order = await openOrder(adv.id);
    await expect(orders.update(order.id, other.id, edit)).rejects.toThrow(
      'Это не ваш заказ',
    );
    await orders.close(order.id, adv.id);
    await expect(orders.update(order.id, adv.id, edit)).rejects.toThrow(
      'Изменить можно только',
    );
  });

  it('срок после повторной проверки сдвигается на время проверки, а не на возраст заказа', async () => {
    const adv = await user();
    const order = await openOrder(adv.id, new Date(Date.now() + 7 * DAY));
    // заказу 10 дней, правка ушла на проверку 2 часа назад, срок при правке не меняли
    await orders.update(order.id, adv.id, edit);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        createdAt: new Date(Date.now() - 10 * DAY),
        moderationRequestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
    const before = (
      await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    ).deadline!.getTime();
    const approved = await approveOrder(order.id, 1n);
    const shiftHours =
      (approved.deadline!.getTime() - before) / (60 * 60 * 1000);
    expect(shiftHours).toBeCloseTo(2, 1);
  });
});

describe('правка заказа — защита', () => {
  const edit = {
    title: 'Новое',
    description: 'Новое описание',
    priceKopecks: null,
    category: 'OTHER' as const,
  };

  it('модератор не может одобрить версию, которую не видел', async () => {
    const adv = await user();
    const order = await pendingOrder(adv.id);
    const seen = await versionOf(order.id);
    await new Promise((r) => setTimeout(r, 5)); // правка — позже, чем модератор открыл заказ
    await orders.update(order.id, adv.id, { ...edit, title: 'Пишите @ivan' });
    await expect(orders.moderatorApprove(order.id, 1n, seen)).rejects.toThrow(
      'изменён',
    );
    expect(await statusOf(order.id)).toBe('PENDING_MODERATION');
  });

  it('цену нельзя менять, пока есть сданные видео', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://example.com/v');
    await expect(
      orders.update(order.id, adv.id, { ...edit, priceKopecks: 100 }),
    ).rejects.toThrow('Цену нельзя менять');
    // без смены цены — можно
    await orders.update(order.id, adv.id, {
      ...edit,
      priceKopecks: order.priceKopecks,
    });
  });

  it('срок «как было» у заказа на проверке не съедается временем до правки', async () => {
    const adv = await user();
    const order = await pendingOrder(adv.id, new Date(Date.now() + 7 * DAY));
    // отправлен на проверку 2 дня назад, срок — 7 дней от отправки
    await prisma.order.update({
      where: { id: order.id },
      data: {
        moderationRequestedAt: new Date(Date.now() - 2 * DAY),
        deadline: new Date(Date.now() + 5 * DAY),
      },
    });
    await orders.update(order.id, adv.id, edit);
    const published = await approveOrder(order.id, 1n);
    const daysLeft = (published.deadline!.getTime() - Date.now()) / DAY;
    expect(daysLeft).toBeCloseTo(7, 1);
  });

  it('изменённый открытый заказ отклонён — креаторы в ответе, видео больше не принимаются', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await orders.update(order.id, adv.id, edit);
    const rejected = await rejectOrder(order.id, 1n, 'причина');
    expect(rejected.submissions.map((x) => x.creatorId)).toEqual([creator.id]);
    await expect(
      submissions.attachVideo(s.id, creator.id, 'https://example.com/v'),
    ).rejects.toThrow('снят модератором');
  });
});

describe('гонки и снятые заказы', () => {
  it('разные креаторы откликаются одновременно — все отклики проходят', async () => {
    const adv = await user();
    const order = await openOrder(adv.id);
    const creators = await Promise.all([1, 2, 3, 4, 5].map(() => user()));
    const results = await Promise.allSettled(
      creators.map((c) => submissions.claim(order.id, c.id)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(5).fill('fulfilled'));
  });

  it('отклонили изменённый заказ — видео по нему сняты с очередей и не одобряются', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://example.com/v');
    await orders.update(order.id, adv.id, {
      title: 'Новое',
      description: 'Описание',
      priceKopecks: order.priceKopecks,
      category: 'OTHER',
    });
    await rejectOrder(order.id, 1n, 'контакты в названии');
    const after = await prisma.submission.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(after.status).toBe('MODERATOR_REJECTED');
    await expect(submissions.moderatorApprove(s.id, 1n)).rejects.toThrow();
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

    const first = await approveOrder(created[0].id, 1n);
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
      approveOrder(order.id, 1n),
      rejectOrder(order.id, 2n, 'причина'),
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
    await approveOrder(accepted.id, 1n);
    const s = await submissions.claim(accepted.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');
    await submissions.moderatorApprove(s.id, 1n);
    await submissions.advertiserApprove(s.id, advertiser.id, {
      rating: 5,
      review: null,
      portfolioAllowed: false,
    });

    const rejected = await pendingOrder(advertiser.id);
    await rejectOrder(rejected.id, 1n, 'причина');
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

    const profile = await profiles.profile(creator.id, true);

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

  it('рекламодателю — только имя, без @username и соцсетей', async () => {
    const creator = await prisma.user.create({
      data: {
        telegramId: nextTelegramId++,
        username: 'secret_creator',
        firstName: 'Аня',
        tiktokUrl: 'https://www.tiktok.com/@secret_creator',
      },
    });
    await acceptedVideo((await user()).id, creator.id, 5, true);

    const forAdvertiser = await profiles.profile(creator.id, false);
    expect(forAdvertiser.name).toBe('Аня');
    // портфолио — только названия работ: ссылка обычно ведёт на аккаунт креатора
    expect(forAdvertiser.portfolio).toHaveLength(1);
    expect(forAdvertiser.portfolio[0].videoUrl).toBeNull();
    expect(forAdvertiser.links).toEqual({
      tiktokUrl: null,
      youtubeUrl: null,
      vkUrl: null,
    });
    expect(JSON.stringify(forAdvertiser)).not.toContain('secret_creator');

    const full = await profiles.profile(creator.id, true);
    expect(full.name).toBe('@secret_creator');
    expect(full.links.tiktokUrl).toContain('secret_creator');
    expect(full.portfolio[0].videoUrl).not.toBeNull();
  });

  it('модератор удаляет отзыв — приёмка и счётчик выполненных остаются', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const s = await acceptedVideo(advertiser.id, creator.id, 1);

    await submissions.removeReview(s.id);

    const profile = await profiles.profile(creator.id, true);
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

describe('жалобы', () => {
  const report = (
    target: string,
    targetId: number,
    reason = 'FRAUD',
    comment?: string,
  ) => reports.parse({ target, targetId, reason, comment });

  it('на заказ: чужой опубликованный — можно, свой и на модерации — нельзя, дважды — нельзя', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const open = await openOrder(advertiser.id);
    const pending = await pendingOrder(advertiser.id);

    await expect(
      reports.create(creator, report('ORDER', open.id)),
    ).resolves.toContain('заказ');
    await expect(
      reports.create(creator, report('ORDER', open.id)),
    ).rejects.toThrow('уже пожаловались');
    await expect(
      reports.create(advertiser, report('ORDER', open.id)),
    ).rejects.toThrow('Не найдено');
    await expect(
      reports.create(creator, report('ORDER', pending.id)),
    ).rejects.toThrow('Не найдено');
  });

  it('причина — из списка своего типа; «Другое» — только с комментарием', () => {
    expect(() => report('ORDER', 1, 'STOLEN')).toThrow('причину');
    expect(() => report('ORDER', 1, 'OTHER')).toThrow('Опишите');
    expect(
      report('ORDER', 1, 'OTHER', 'просят оплатить доставку').comment,
    ).toBe('просят оплатить доставку');
  });

  it('на видео — только рекламодатель заказа и только после модератора', async () => {
    const [advertiser, creator, stranger] = [
      await user(),
      await user(),
      await user(),
    ];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');

    await expect(
      reports.create(advertiser, report('VIDEO', s.id, 'STOLEN')),
    ).rejects.toThrow('Не найдено');
    await submissions.moderatorApprove(s.id, 1n);
    await expect(
      reports.create(stranger, report('VIDEO', s.id, 'STOLEN')),
    ).rejects.toThrow('Не найдено');
    await expect(
      reports.create(advertiser, report('VIDEO', s.id, 'STOLEN')),
    ).resolves.toContain('видео');
  });

  it('мера по заказу закрывает его, повторное решение — отказ', async () => {
    const [advertiser, c1, c2] = [await user(), await user(), await user()];
    const order = await openOrder(advertiser.id);
    await reports.create(c1, report('ORDER', order.id));
    await reports.create(c2, report('ORDER', order.id, 'SPAM'));

    const [group] = await reports.listOpen();
    expect(group).toMatchObject({ target: 'ORDER', targetId: order.id });
    expect(group.reports).toHaveLength(2);

    const { reporters, closedOrder } = await reports.resolve(
      { target: 'ORDER', targetId: order.id },
      true,
      1n,
    );
    expect(reporters.sort()).toEqual([c1.telegramId, c2.telegramId].sort());
    expect(closedOrder?.status).toBe('CLOSED');
    expect(await reports.listOpen()).toEqual([]);
    await expect(
      reports.resolve({ target: 'ORDER', targetId: order.id }, false, 2n),
    ).rejects.toThrow('уже рассмотрены');
  });

  it('жалоба на отзыв: пишет только тот, о ком отзыв; мера удаляет отзыв', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, 'https://v.example/1');
    await submissions.moderatorApprove(s.id, 1n);
    await submissions.advertiserApprove(s.id, advertiser.id, {
      rating: 1,
      review: 'ужас',
      portfolioAllowed: false,
    });

    await expect(
      reports.create(advertiser, report('REVIEW', s.id, 'INSULT')),
    ).rejects.toThrow('Не найдено');
    await reports.create(creator, report('REVIEW', s.id, 'INSULT'));
    await reports.resolve({ target: 'REVIEW', targetId: s.id }, true, 1n);

    expect(await profiles.profile(creator.id, true)).toMatchObject({
      rating: null,
      completed: 1,
    });
  });
});

describe('блокировка', () => {
  it('закрывает заказы, отклоняет ожидающие модерации, убирает отклики без видео', async () => {
    const [banned, other, creator] = [await user(), await user(), await user()];
    // заказы заблокированного: открытый (с откликом другого креатора) и на модерации
    const open = await openOrder(banned.id);
    const pending = await pendingOrder(banned.id);
    await submissions.claim(open.id, creator.id);
    // отклики заблокированного как креатора: без видео, у модератора, у рекламодателя
    const otherOrder = await openOrder(other.id);
    await submissions.claim(otherOrder.id, banned.id);
    const [o2, o3] = [await openOrder(other.id), await openOrder(other.id)];
    const atModerator = await submissions.claim(o2.id, banned.id);
    await submissions.attachVideo(
      atModerator.id,
      banned.id,
      'https://v.example/1',
    );
    const atAdvertiser = await submissions.claim(o3.id, banned.id);
    await submissions.attachVideo(
      atAdvertiser.id,
      banned.id,
      'https://v.example/2',
    );
    await submissions.moderatorApprove(atAdvertiser.id, 1n);

    const closed = await bans.ban(banned.id, 'мошенничество');

    // и открытый, и отклонённый (на проверке мог быть изменённый открытый — с креаторами в работе)
    expect(closed.map((o) => o.id).sort()).toEqual(
      [open.id, pending.id].sort(),
    );
    // креатору закрытого заказа придёт уведомление
    const openClosed = closed.find((o) => o.id === open.id)!;
    expect(openClosed.submissions.map((s) => s.creator.id)).toEqual([
      creator.id,
    ]);
    expect(await statusOf(open.id)).toBe('CLOSED');
    expect(await statusOf(pending.id)).toBe('REJECTED');
    const left = await prisma.submission.findMany({
      where: { creatorId: banned.id },
      orderBy: { id: 'asc' },
    });
    expect(left.map((s) => [s.id, s.status])).toEqual([
      [atModerator.id, 'MODERATOR_REJECTED'],
      [atAdvertiser.id, 'MODERATOR_APPROVED'],
    ]);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: banned.id } }),
    ).toMatchObject({ banReason: 'мошенничество' });
  });

  it('повторно не блокирует; разблокировка снимает бан', async () => {
    const u = await user();
    await bans.ban(u.id, 'спам');
    await expect(bans.ban(u.id, 'спам')).rejects.toThrow('уже заблокирован');

    await bans.unban(u.id);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: u.id } }),
    ).toMatchObject({ bannedAt: null, banReason: null });
    await expect(bans.unban(u.id)).rejects.toThrow('не заблокирован');
  });
});
