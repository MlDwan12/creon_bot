import type { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { ModeratorGuard } from './auth/moderator.guard';
import { AnalyticsService } from './moderation/analytics.service';
import { BansService } from './moderation/bans.service';
import { ProfilesService } from './profiles/profiles.service';
import { PayoutsService } from './payouts/payouts.service';
import { HOLD_DAYS } from './orders/budget';
import { PUBLICATION_DELETED } from './submissions/submissions.service';
import { ReportsService } from './reports/reports.service';
import { MAX_ACTIVE_ORDERS, OrdersService } from './orders/orders.service';
import { PrismaService } from './prisma/prisma.service';
import {
  MAX_IN_REVIEW,
  SLOT_DAYS,
  SubmissionsService,
} from './submissions/submissions.service';
import { UsersService } from './users/users.service';
import { ViewCounterService } from './submissions/view-counter.service';

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
// API площадки в тестах не отвечает — просмотры те, что указал креатор
const submissions = new SubmissionsService(prisma, {
  fetchViews: () => Promise.resolve(new Map()),
} as unknown as ViewCounterService);
const analytics = new AnalyticsService(prisma);
const profiles = new ProfilesService(prisma);
const reports = new ReportsService(prisma, orders, profiles);
const moderators = new ModeratorGuard({
  get: () => '777',
} as unknown as ConfigService);
const bans = new BansService(prisma, reports, moderators);
const users = new UsersService(prisma);
const payouts = new PayoutsService(prisma);

const DAY = 24 * 60 * 60 * 1000;
/** Каждый сданный ролик — своя ссылка: один ролик нельзя сдать дважды (Submission_video_once). */
let nextVideo = 0;
const videoUrl = () => `https://v.example/${++nextVideo}`;
let nextTelegramId = 1n;

function user() {
  const telegramId = nextTelegramId++;
  return prisma.user.create({
    data: { telegramId, username: `user${telegramId}` },
  });
}

/** Бюджет 50 000 USDT при комиссии 20% — фонд креаторам 40 000 USDT. */
const BUDGET = 5_000_000;
/** Ставка 100 USDT за 1000 просмотров: ролик с 1000 просмотров — 100 USDT. */
const CPM = 10_000;
const VIEWS = 1000;

async function pendingOrder(
  advertiserId: number,
  deadline?: Date,
  budgetMinor = BUDGET,
) {
  return orders.create(advertiserId, {
    title: 'Заказ',
    description: 'Описание',
    category: 'OTHER',
    budgetMinor,
    minViews: 250,
    deadline,
  });
}

/** Решение модератора по текущей версии заказа — той, что он открыл бы в мини-аппе. */
const versionOf = async (orderId: number) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
    .moderationRequestedAt;
const approveOrder = async (orderId: number, mod: bigint, cpm = CPM) =>
  orders.moderatorApprove(orderId, mod, await versionOf(orderId), cpm);
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

  it('второй отклик «в работе» — нельзя, пока ролик на проверке — можно', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);

    const first = await submissions.claim(order.id, creator.id);
    await expect(submissions.claim(order.id, creator.id)).rejects.toThrow(
      'в работе',
    );

    await submissions.attachVideo(first.id, creator.id, videoUrl(), VIEWS);
    await expect(
      submissions.claim(order.id, creator.id),
    ).resolves.toBeDefined();
  });

  it('сдача по чужому отклику отклоняется до запроса к API площадки', async () => {
    const [advertiser, creator, stranger] = [
      await user(),
      await user(),
      await user(),
    ];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    const fetchViews = jest.fn(() =>
      Promise.resolve(
        new Map([
          ['https://youtu.be/dQw4w9WgXcQ', { views: 5000, likes: null }],
        ]),
      ),
    );
    const counted = new SubmissionsService(prisma, {
      fetchViews,
    } as unknown as ViewCounterService);
    const video = { url: 'https://youtu.be/dQw4w9WgXcQ', views: 300 };

    await expect(counted.submitVideo(s.id, stranger.id, video)).rejects.toThrow(
      'не ваш',
    );
    expect(fetchViews).not.toHaveBeenCalled();
    // свой — просмотры из API, а не со слов креатора
    expect((await counted.submitVideo(s.id, creator.id, video)).views).toBe(
      5000,
    );
  });

  it('повторная сдача той же ссылки не тратит квоту площадки: просмотры запомнены', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    // меньше порога (250) — сдать нельзя, креатор пробует ещё
    const fetchViews = jest.fn(() =>
      Promise.resolve(
        new Map([
          ['https://youtu.be/dQw4w9WgXcQ', { views: 100, likes: null }],
        ]),
      ),
    );
    const counted = new SubmissionsService(prisma, {
      fetchViews,
    } as unknown as ViewCounterService);
    const video = { url: 'https://youtu.be/dQw4w9WgXcQ', views: 9999 };

    for (let i = 0; i < 3; i++)
      await expect(
        counted.submitVideo(s.id, creator.id, video),
      ).rejects.toThrow('наберёт');
    expect(fetchViews).toHaveBeenCalledTimes(1);
  });

  it('старым роликам ставится ключ: повторно не сдать, дубль остаётся без ключа', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    // как до videoKey: два отклика на проверке с одним роликом под разными ссылками
    const old = (url: string) =>
      prisma.submission.create({
        data: {
          orderId: order.id,
          creatorId: creator.id,
          status: 'SUBMITTED',
          videoUrl: url,
        },
      });
    const first = await old('https://youtu.be/dQw4w9WgXcQ');
    const dup = await old('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(await submissions.backfillVideoKeys()).toEqual({
      filled: 1,
      duplicates: [dup.id],
    });
    const key = async (id: number) =>
      (await prisma.submission.findUniqueOrThrow({ where: { id } })).videoKey;
    expect(await key(first.id)).toBe('youtube:dQw4w9WgXcQ');
    expect(await key(dup.id)).toBeNull();

    const other = await openOrder(advertiser.id);
    const s = await submissions.claim(other.id, creator.id);
    await expect(
      submissions.attachVideo(
        s.id,
        creator.id,
        'https://youtube.com/shorts/dQw4w9WgXcQ',
        VIEWS,
      ),
    ).rejects.toThrow('уже сдан');
  });

  it('ключ по старому правилу (ник в ссылке TikTok) пересчитывается по id ролика, дубль — в лог', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    // как до ключа по id: один ролик, ник в разном регистре — ключи разные, оба одобрены
    const old = (url: string, videoKey: string) =>
      prisma.submission.create({
        data: {
          orderId: order.id,
          creatorId: creator.id,
          status: 'MODERATOR_APPROVED',
          videoUrl: url,
          videoKey,
        },
      });
    const first = await old(
      'https://www.tiktok.com/@anya/video/12345',
      'tiktok.com/@anya/video/12345',
    );
    const dup = await old(
      'https://www.tiktok.com/@ANYA/video/12345',
      'tiktok.com/@ANYA/video/12345',
    );

    expect(await submissions.backfillVideoKeys()).toEqual({
      filled: 1,
      duplicates: [dup.id],
    });
    const key = async (id: number) =>
      (await prisma.submission.findUniqueOrThrow({ where: { id } })).videoKey;
    expect(await key(first.id)).toBe('tiktok:12345');

    const other = await openOrder(advertiser.id);
    const s = await submissions.claim(other.id, creator.id);
    await expect(
      submissions.attachVideo(
        s.id,
        creator.id,
        'https://www.tiktok.com/@someone/video/12345',
        VIEWS,
      ),
    ).rejects.toThrow('уже сдан');
  });

  it(`на проверке у креатора по заказу — не больше ${MAX_IN_REVIEW} роликов`, async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const submit = async () => {
      const s = await submissions.claim(order.id, creator.id);
      await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
      return s;
    };
    const first = await submit();
    await submit();
    await submit();
    const fourth = await submissions.claim(order.id, creator.id);
    const attach = () =>
      submissions.attachVideo(fourth.id, creator.id, videoUrl(), VIEWS);
    await expect(attach()).rejects.toThrow('дождитесь решения');

    // одобренный в лимит не входит — тот же отклик теперь сдаётся
    await submissions.moderatorApprove(first.id, 1n, VIEWS);
    await attach();
    expect(
      await prisma.submission.count({
        where: { orderId: order.id, status: 'SUBMITTED' },
      }),
    ).toBe(MAX_IN_REVIEW);
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

describe('слот на видео', () => {
  it('без видео за SLOT_DAYS дней сгорает, после — можно откликнуться снова', async () => {
    const adv = await user();
    const creator = await user();
    const order = await openOrder(adv.id);
    const fresh = await submissions.claim(order.id, creator.id);
    const old = await submissions.claim(
      (await openOrder(adv.id)).id,
      creator.id,
    );
    await prisma.submission.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - (SLOT_DAYS * DAY + 1000)) },
    });

    // Напоминание — только по старому и один раз.
    expect(await submissions.listSlotEndingSoon()).toEqual([{ id: old.id }]);
    expect(await submissions.markSlotReminded(old.id)).not.toBeNull();
    expect(await submissions.markSlotReminded(old.id)).toBeNull();
    expect(await submissions.listSlotEndingSoon()).toEqual([]);

    expect(await submissions.listSlotOverdue()).toEqual([{ id: old.id }]);
    expect((await submissions.expireSlot(old.id))?.status).toBe('SLOT_EXPIRED');
    expect(await submissions.expireSlot(old.id)).toBeNull();
    await expect(
      submissions.attachVideo(old.id, creator.id, videoUrl(), VIEWS),
    ).rejects.toThrow();
    await expect(
      submissions.claim(old.orderId, creator.id),
    ).resolves.toBeDefined();
    expect((await submissions.findById(fresh.id))?.status).toBe('IN_PROGRESS');
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
      submissions.attachVideo(inProgress.id, creator.id, videoUrl(), VIEWS),
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
      submissions.attachVideo(inProgress.id, creator.id, videoUrl(), VIEWS),
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

describe('воронка в отчёте', () => {
  it('открытие карточки считается раз на креатора; взяли — все отклики', async () => {
    const [adv, a, b] = [await user(), await user(), await user()];
    const order = await openOrder(adv.id);
    await orders.markViewed(order.id, a.id);
    await orders.markViewed(order.id, a.id);
    await orders.markViewed(order.id, b.id);
    const claim = await submissions.claim(order.id, a.id);
    await submissions.attachVideo(claim.id, a.id, videoUrl(), VIEWS);

    const { funnel } = await orders.report(order);
    expect(funnel).toEqual({
      viewers: 2,
      taken: 1,
      expired: 0,
      onReview: 1,
      rejected: 0,
      approved: 0,
    });
  });
});

describe('ссылка на товар', () => {
  it('переход засчитывается креатору и ведёт на страницу товара; без страницы — null', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const { trackCode } = await submissions.claim(order.id, creator.id);
    expect(trackCode).toMatch(/^[\w-]{12}$/);

    expect(await submissions.click(trackCode!)).toBeNull();
    await prisma.order.update({
      where: { id: order.id },
      data: { targetUrl: 'https://shop.example/item' },
    });
    expect(await submissions.click(trackCode!)).toBe(
      'https://shop.example/item',
    );
    expect(await submissions.click('нет-такого')).toBeNull();

    // правка ссылки ещё у модератора или заказ снят — по ссылке не ведём и переход не считаем
    for (const status of [
      OrderStatus.PENDING_MODERATION,
      OrderStatus.REJECTED,
    ]) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status, targetUrl: 'https://phish.example' },
      });
      expect(await submissions.click(trackCode!)).toBeNull();
    }

    const { clicks } = await prisma.submission.findUniqueOrThrow({
      where: { trackCode: trackCode! },
    });
    expect(clicks).toBe(1);
  });

  it('ссылка на ролик для рекламодателя (/v/) ведёт на ролик — только одобренный, переход не считается', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    const url = videoUrl();
    await submissions.attachVideo(s.id, creator.id, url, VIEWS);
    expect(await submissions.videoByCode(s.trackCode!)).toBeNull();

    await submissions.moderatorApprove(s.id, 1n, VIEWS);
    expect(await submissions.videoByCode(s.trackCode!)).toBe(url);
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: s.id } }))
        .clicks,
    ).toBe(0);
  });
});

describe('каталог', () => {
  it('hasMore — есть ли следующая страница; total — число открытых', async () => {
    const adv = await user();
    for (let i = 0; i < 3; i++) await openOrder(adv.id);
    await pendingOrder(adv.id); // на модерации — не в каталоге

    const first = await orders.listOpen(undefined, undefined, undefined, 2);
    expect(first).toMatchObject({ hasMore: true, total: 3 });
    expect(first.items).toHaveLength(2);

    const tail = first.items[1];
    const last = await orders.listOpen(undefined, undefined, tail, 2);
    expect(last.hasMore).toBe(false);
    expect(last.items).toHaveLength(1);
  });

  it('закрытый заказ, пока листали, не сдвигает следующую страницу', async () => {
    const adv = await user();
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await openOrder(adv.id)).id);
    const first = await orders.listOpen(undefined, undefined, undefined, 2); // новые: ids[3], ids[2]
    await orders.close(first.items[0].id, adv.id); // закрыли уже показанный
    const next = await orders.listOpen(undefined, undefined, first.items[1], 2);
    expect(next.items.map((o) => o.id)).toEqual([ids[1], ids[0]]);
  });

  it('фильтр по площадке: заказы для неё и без ограничений; ролик с другой площадки не сдать', async () => {
    const [adv, creator] = [await user(), await user()];
    const any = await openOrder(adv.id);
    const tiktok = await openOrder(adv.id);
    await prisma.order.update({
      where: { id: tiktok.id },
      data: { platforms: ['TIKTOK'] },
    });

    const ids = async (p: 'TIKTOK' | 'INSTAGRAM') =>
      (await orders.listOpen(undefined, p, undefined, 10)).items.map(
        (o) => o.id,
      );
    expect(await ids('TIKTOK')).toEqual([tiktok.id, any.id]);
    expect(await ids('INSTAGRAM')).toEqual([any.id]);

    const s = await submissions.claim(tiktok.id, creator.id);
    await expect(
      submissions.attachVideo(
        s.id,
        creator.id,
        'https://www.instagram.com/reel/abc/',
        VIEWS,
      ),
    ).rejects.toThrow('только в TikTok');
    await submissions.attachVideo(
      s.id,
      creator.id,
      'https://www.tiktok.com/@a/video/123',
      VIEWS,
    );
  });
});

describe('правка заказа', () => {
  const edit = {
    title: 'Новое название',
    description: 'Новое описание',
    budgetMinor: BUDGET,
    minViews: 250,
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

  it('пустая правка ничего не делает; уведомления — только при заморозке и заново в очереди', async () => {
    const adv = await user();
    const order = await openOrder(adv.id);
    const same = {
      title: 'Заказ',
      description: 'Описание',
      budgetMinor: BUDGET,
      minViews: 250,
      category: 'OTHER' as const,
    };
    const noop = await orders.update(order.id, adv.id, same);
    expect(noop.notify).toEqual({ moderators: false, creators: false });
    expect(await statusOf(order.id)).toBe('OPEN');

    // первая правка открытого: на проверку, креаторы узнают о заморозке
    expect((await orders.update(order.id, adv.id, edit)).notify).toEqual({
      moderators: true,
      creators: true,
    });
    // ещё правка, пока на проверке, — никого не будит
    expect(
      (await orders.update(order.id, adv.id, { ...edit, title: 'Ещё раз' }))
        .notify,
    ).toEqual({ moderators: false, creators: false });
    // отклонённую отправили снова — модераторам: заказ заново в очереди
    await rejectOrder(order.id, 1n, 'Уточните задание');
    expect((await orders.update(order.id, adv.id, edit)).notify).toEqual({
      moderators: true,
      creators: false,
    });
  });

  it('рассылка о новом заказе — только при первой публикации, не после правки', async () => {
    const adv = await user();
    const order = await openOrder(adv.id);
    expect(order.firstPublication).toBe(true);
    await orders.update(order.id, adv.id, edit);
    expect((await approveOrder(order.id, 1n)).firstPublication).toBe(false);
  });

  it('бюджет повышен — одобрить можно, только подтвердив доплату на новую сумму', async () => {
    const adv = await user();
    const order = await openOrder(adv.id);
    expect(order.approvedBudgetMinor).toBe(BUDGET);
    const raised = BUDGET * 2;
    await orders.update(order.id, adv.id, { ...edit, budgetMinor: raised });

    const approve = async (confirmed: number | null) =>
      orders.moderatorApprove(
        order.id,
        1n,
        await versionOf(order.id),
        CPM,
        confirmed,
      );
    await expect(approve(null)).rejects.toThrow('доплата получена');
    // подтверждение другой суммы (устаревшей версии) не подходит
    await expect(approve(BUDGET)).rejects.toThrow('доплата получена');
    expect((await approve(raised)).approvedBudgetMinor).toBe(raised);

    // понижение подтверждать не нужно
    await orders.update(order.id, adv.id, edit);
    expect((await approveOrder(order.id, 1n)).approvedBudgetMinor).toBe(BUDGET);
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
    budgetMinor: BUDGET,
    minViews: 250,
    category: 'OTHER' as const,
  };

  it('модератор не может одобрить версию, которую не видел', async () => {
    const adv = await user();
    const order = await pendingOrder(adv.id);
    const seen = await versionOf(order.id);
    await new Promise((r) => setTimeout(r, 5)); // правка — позже, чем модератор открыл заказ
    await orders.update(order.id, adv.id, { ...edit, title: 'Пишите @ivan' });
    await expect(
      orders.moderatorApprove(order.id, 1n, seen, CPM),
    ).rejects.toThrow('изменён');
    expect(await statusOf(order.id)).toBe('PENDING_MODERATION');
  });

  it('бюджет нельзя уменьшить ниже потраченного и зарезервированного', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
    // 100 000 просмотров × 100 USDT за 1000 = 10 000 USDT начислено
    await submissions.moderatorApprove(s.id, 1n, 100_000);
    // бюджет 12 000 USDT → фонд 9 600 USDT < 10 000 USDT
    await expect(
      orders.update(order.id, adv.id, { ...edit, budgetMinor: 1_200_000 }),
    ).rejects.toThrow('нельзя сделать меньше');
    await orders.update(order.id, adv.id, { ...edit, budgetMinor: 1_300_000 });
  });

  /** Ролик на проверке, сданный за минуту до правки заказа. */
  async function videoBeforeEdit(orderId: number, creatorId: number) {
    const s = await submissions.claim(orderId, creatorId);
    await submissions.attachVideo(s.id, creatorId, videoUrl(), VIEWS);
    await prisma.submission.update({
      where: { id: s.id },
      data: { submittedAt: new Date(Date.now() - 60_000) },
    });
    return s;
  }

  it('неоплаченное повышение бюджета не тратится на ролики, пока правку не одобрили', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await videoBeforeEdit(order.id, creator.id);
    await orders.update(order.id, adv.id, {
      ...edit,
      budgetMinor: BUDGET * 10,
    });

    // 1 000 000 просмотров × 100 USDT за 1000 = 100 000 USDT, а оплачен фонд 40 000 USDT
    const approved = await submissions.moderatorApprove(s.id, 1n, 1_000_000);
    expect(approved.submission.payoutMinor).toBe(4_000_000);
  });

  it('ролик, сданный до правки, — по порогу и ставке до неё', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await videoBeforeEdit(order.id, creator.id);
    // порог поднят выше просмотров ролика, ставка при одобрении правки — впятеро выше
    await orders.update(order.id, adv.id, { ...edit, minViews: 5000 });
    await approveOrder(order.id, 1n, CPM * 5);

    const approved = await submissions.moderatorApprove(s.id, 1n, VIEWS);
    expect(approved.submission.payoutMinor).toBe(10_000); // 1000 просмотров × 100 USDT за 1000

    // после правки — новые условия
    const next = await submissions.claim(order.id, creator.id);
    await expect(
      submissions.attachVideo(next.id, creator.id, videoUrl(), VIEWS),
    ).rejects.toThrow();
    await submissions.attachVideo(next.id, creator.id, videoUrl(), 5000);
    expect(
      (await submissions.moderatorApprove(next.id, 1n, 5000)).submission
        .payoutMinor,
    ).toBe(250_000); // 5000 × 500 USDT за 1000
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

  it('правку отклонили — заказ заморожен (EDIT_REJECTED), видео не принимаются', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await orders.update(order.id, adv.id, edit);
    const rejected = await rejectOrder(order.id, 1n, 'причина');
    expect(rejected.status).toBe('EDIT_REJECTED');
    await expect(
      submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS),
    ).rejects.toThrow('после решения модератора');
  });
});

describe('заморозка при правке', () => {
  const edit = {
    title: 'Новое',
    description: 'Описание',
    targetUrl: 'https://shop.example/new',
    budgetMinor: BUDGET,
    minViews: 500,
    category: 'FOOD' as const,
  };

  it('пока правка на проверке — сдать нельзя и слот не сгорает; после одобрения слот продлён', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    // взял 6 дней назад, правка — 3 дня назад: без заморозки слот уже сгорел бы
    await prisma.submission.update({
      where: { id: s.id },
      data: { createdAt: new Date(Date.now() - 6 * DAY) },
    });
    await orders.update(order.id, adv.id, edit);
    await prisma.order.update({
      where: { id: order.id },
      data: { editedAt: new Date(Date.now() - 3 * DAY) },
    });
    await prisma.submission.update({
      where: { id: s.id },
      data: { createdAt: new Date(Date.now() - 8 * DAY) },
    });
    await expect(
      submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS),
    ).rejects.toThrow('после решения модератора');
    expect(await submissions.listSlotOverdue()).toEqual([]);

    const approved = await approveOrder(order.id, 1n);
    expect(approved.unfrozen).toBe(true);
    expect(approved.submissions.map((x) => x.id)).toEqual([s.id]);
    const after = await prisma.submission.findUniqueOrThrow({
      where: { id: s.id },
    });
    // 8 дней назад + 3 дня заморозки = 5 дней назад: слот ещё жив
    expect((Date.now() - after.createdAt.getTime()) / DAY).toBeCloseTo(5, 1);
    expect(await submissions.listSlotOverdue()).toEqual([]);
    await expect(
      submissions.attachVideo(s.id, creator.id, videoUrl(), 1000),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
  });

  it('прежние условия — с первой правки; отклонённую правку можно исправить', async () => {
    const adv = await user();
    const order = await openOrder(adv.id);
    await orders.update(order.id, adv.id, edit);
    const first = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(first.prevTerms).toMatchObject({ title: 'Заказ', minViews: 250 });
    await rejectOrder(order.id, 1n, 'контакты');
    await orders.update(order.id, adv.id, { ...edit, title: 'Ещё новее' });
    const second = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(second).toMatchObject({
      status: 'PENDING_MODERATION',
      title: 'Ещё новее',
      editedAt: first.editedAt,
      prevTerms: first.prevTerms,
      moderatorComment: null,
    });
  });

  it('правку отклонили — ролик, сданный до правки, проверяется и оплачивается как обычно', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
    await orders.update(order.id, adv.id, edit);
    await rejectOrder(order.id, 1n, 'контакты в названии');
    await expect(
      submissions.moderatorApprove(s.id, 1n, VIEWS),
    ).resolves.toMatchObject({
      submission: { status: 'MODERATOR_APPROVED' },
    });
  });

  it('вторая правка не меняет условия ролика, сданного до первой', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
    await orders.update(order.id, adv.id, { ...edit, minViews: 100_000 });
    await approveOrder(order.id, 1n);
    await orders.update(order.id, adv.id, {
      ...edit,
      minViews: 100_000,
      title: 'Ещё',
    });
    // сдан при пороге 250 — по нему и проверяется, хотя снимок до правки уже второй
    await expect(
      submissions.moderatorApprove(s.id, 1n, VIEWS),
    ).resolves.toMatchObject({
      submission: { status: 'MODERATOR_APPROVED' },
    });
  });

  it('закрыли замороженный — слоты сгорели, правка отменена, сданное доводится до конца', async () => {
    const [adv, waiting, done] = [await user(), await user(), await user()];
    const order = await openOrder(adv.id);
    const inWork = await submissions.claim(order.id, waiting.id);
    const sent = await submissions.claim(order.id, done.id);
    await submissions.attachVideo(sent.id, done.id, videoUrl(), VIEWS);
    await orders.update(order.id, adv.id, { ...edit, budgetMinor: BUDGET * 2 });
    await rejectOrder(order.id, 1n, 'контакты');

    const closed = await orders.close(order.id, adv.id);
    expect(closed.burned.map((x) => x.id)).toEqual([inWork.id]);
    expect(closed).toMatchObject({
      status: 'CLOSED',
      title: 'Заказ',
      targetUrl: null,
      minViews: 250,
      category: 'OTHER',
      budgetMinor: BUDGET,
    });
    expect((await submissions.findById(inWork.id))?.status).toBe(
      'SLOT_EXPIRED',
    );
    await expect(
      submissions.moderatorApprove(sent.id, 1n, VIEWS),
    ).resolves.toBeDefined();
  });

  it('открытый заказ закрывается как раньше — начатые ролики ещё принимаются', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    expect((await orders.close(order.id, adv.id)).burned).toEqual([]);
    await expect(
      submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
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
});

describe('бюджет и просмотры', () => {
  /** Заказ с бюджетом `rubles` при ставке 100 USDT за 1000 просмотров. */
  async function orderWith(advertiserId: number, rubles: number) {
    const order = await pendingOrder(advertiserId, undefined, rubles * 100);
    return approveOrder(order.id, 1n);
  }
  const free = async (orderId: number) =>
    (
      await submissions.orderBudget(
        await prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      )
    ).free;
  const sent = async (orderId: number, creatorId: number, views: number) => {
    const s = await submissions.claim(orderId, creatorId);
    return submissions.attachVideo(s.id, creatorId, videoUrl(), views);
  };

  it('ставку, при которой фонда не хватит на порог, модератор не поставит', async () => {
    const adv = await user();
    // бюджет 1 000 USDT → фонд 800 USDT; порог 250 просмотров × 4 000 USDT = 1 000 USDT
    const order = await pendingOrder(adv.id, undefined, 100_000);
    await expect(approveOrder(order.id, 1n, 400_000)).rejects.toThrow(
      'уменьшите ставку',
    );
  });

  it('меньше порога — не сдать и не одобрить', async () => {
    const [adv, creator] = [await user(), await user()];
    const order = await openOrder(adv.id);
    const s = await submissions.claim(order.id, creator.id);
    await expect(
      submissions.attachVideo(s.id, creator.id, videoUrl(), 249),
    ).rejects.toThrow('наберёт 250');
    await submissions.attachVideo(s.id, creator.id, videoUrl(), 300);
    await expect(submissions.moderatorApprove(s.id, 1n, 200)).rejects.toThrow(
      'Меньше порога',
    );
  });

  it('резерв при сдаче, начисление по просмотрам модератора, отказ возвращает резерв', async () => {
    const [adv, a, b] = [await user(), await user(), await user()];
    const order = await orderWith(adv.id, 10_000); // фонд 8 000 USDT
    // резерв — за порог (250 просмотров = 25 USDT), а не за заявленные 2000
    const s1 = await sent(order.id, a.id, 2000);
    expect(s1.payoutMinor).toBe(2_500);
    expect(await free(order.id)).toBe(797_500);

    // модератор насчитал меньше — начисляется по его цифре
    const { submission } = await submissions.moderatorApprove(s1.id, 1n, 1500);
    expect(submission).toMatchObject({ payoutMinor: 15_000, views: 1500 });
    expect(await free(order.id)).toBe(785_000);

    const s2 = await sent(order.id, b.id, 1000);
    await submissions.moderatorReject(s2.id, 1n, 'чужой ролик');
    expect(await free(order.id)).toBe(785_000);
  });

  it('фонд не уходит в минус: резерв урезается остатком, заказ закрывает начисленное', async () => {
    const [adv, a, b, c] = [
      await user(),
      await user(),
      await user(),
      await user(),
    ];
    const order = await orderWith(adv.id, 1_000); // фонд 800 USDT; порог — 25 USDT
    const inProgress = await submissions.claim(order.id, c.id);
    const s1 = await sent(order.id, a.id, 7_750);
    await submissions.moderatorApprove(s1.id, 1n, 7_750); // 775 USDT, свободно 25 USDT
    // последний резерв за порог занимает остаток; заказ открыт: резерв может вернуться
    const s2 = await sent(order.id, b.id, 5_000);
    expect(s2.payoutMinor).toBe(2_500);
    expect(await statusOf(order.id)).toBe('OPEN');
    await expect(
      submissions.attachVideo(inProgress.id, c.id, videoUrl(), 1000),
    ).rejects.toThrow('не хватает');
    // одобрение не превышает резерв + свободное; начислено всё — заказ закрыт, креатору «в работе» — уведомление
    const last = await submissions.moderatorApprove(s2.id, 1n, 5_000);
    expect(last.submission.payoutMinor).toBe(2_500);
    expect(last.closed?.submissions.map((x) => x.creatorId)).toEqual([c.id]);
    expect(await statusOf(order.id)).toBe('CLOSED');
  });

  it('завышенные просмотры резервируют только порог — фонд не занять', async () => {
    const [adv, liar, honest] = [await user(), await user(), await user()];
    const order = await orderWith(adv.id, 1_000); // фонд 800 USDT
    const s = await sent(order.id, liar.id, 1_000_000_000);
    expect(s.payoutMinor).toBe(2_500);
    expect(await free(order.id)).toBe(77_500);
    await sent(order.id, honest.id, 1000);
  });

  it('один ролик — одна оплата: ту же ссылку не сдать ни в другой заказ, ни в тот же', async () => {
    const [adv, a, b] = [await user(), await user(), await user()];
    const o1 = await orderWith(adv.id, 1_000);
    const o2 = await orderWith(adv.id, 1_000);
    const s = await submissions.claim(o1.id, a.id);
    await submissions.attachVideo(
      s.id,
      a.id,
      'https://youtu.be/dQw4w9WgXcQ',
      VIEWS,
    );
    // та же ссылка в другом виде и другим креатором
    const other = await submissions.claim(o2.id, b.id);
    await expect(
      submissions.attachVideo(
        other.id,
        b.id,
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5',
        VIEWS,
      ),
    ).rejects.toThrow('уже сдан');
    // отказ по сдаче не съедает слот
    expect((await submissions.findById(other.id))?.status).toBe('IN_PROGRESS');
    // отклонённый ролик можно прислать снова
    await submissions.moderatorReject(s.id, 1n, 'не по заданию');
    await submissions.attachVideo(
      other.id,
      b.id,
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      VIEWS,
    );
  });

  it('заказ, израсходованный на повторной проверке, после одобрения закрыт, а не открыт', async () => {
    const [adv, a] = [await user(), await user()];
    const order = await orderWith(adv.id, 1_000); // фонд 800 USDT
    const s = await sent(order.id, a.id, 8_000); // резерв 800 USDT
    await orders.update(order.id, adv.id, {
      title: 'Новое',
      description: 'Описание',
      budgetMinor: 100_000,
      minViews: 250,
      category: 'OTHER',
    });
    // на проверке заказ не закрывается — одобренный ролик забирает весь фонд
    const { closed } = await submissions.moderatorApprove(s.id, 1n, 8_000);
    expect(closed).toBeNull();
    expect(await statusOf(order.id)).toBe('PENDING_MODERATION');
    const approved = await approveOrder(order.id, 1n);
    expect(approved.status).toBe('CLOSED');
    expect(approved.closedAt).not.toBeNull();
  });

  it('одновременные сдачи на остаток — вместе не больше фонда', async () => {
    const adv = await user();
    const creators = await Promise.all([1, 2, 3, 4].map(() => user()));
    const order = await orderWith(adv.id, 75); // фонд 60 USDT — на два резерва за порог по 25
    const claims = await Promise.all(
      creators.map((c) => submissions.claim(order.id, c.id)),
    );
    await Promise.allSettled(
      claims.map((s, i) =>
        submissions.attachVideo(s.id, creators[i].id, videoUrl(), 3_000),
      ),
    );
    const total = await prisma.submission.aggregate({
      where: { orderId: order.id, status: 'SUBMITTED' },
      _sum: { payoutMinor: true },
    });
    expect(total._sum.payoutMinor).toBe(5_000);
  });

  it('автоматический итог холда не проходит, если креатора забанили во время запроса к API', async () => {
    const [adv, a] = [await user(), await user()];
    const order = await orderWith(adv.id, 10_000);
    const s = await sent(order.id, a.id, 1000);
    await submissions.moderatorApprove(s.id, 1n, 1000);
    await prisma.submission.update({
      where: { id: s.id },
      data: { decidedAt: new Date(Date.now() - HOLD_DAYS * DAY - 1000) },
    });
    // listHoldDue прочитан до бана, бан — пока ждали API
    await prisma.user.update({
      where: { id: a.id },
      data: { bannedAt: new Date() },
    });
    await expect(
      submissions.finalizeViews(s.id, 3000, null, true),
    ).rejects.toThrow();
    expect((await submissions.findById(s.id))?.finalizedAt).toBeNull();
    // модератор по-прежнему может зафиксировать итог сам
    await expect(submissions.finalizeViews(s.id, 3000)).resolves.toBeDefined();
  });

  it('итог холда — через HOLD_DAYS, один раз, без доплаты: просмотры только для отчёта', async () => {
    const [adv, a] = [await user(), await user()];
    const order = await orderWith(adv.id, 10_000);
    const s = await sent(order.id, a.id, 1000);
    await submissions.moderatorApprove(s.id, 1n, 1000, 40); // 100 USDT
    await expect(submissions.finalizeViews(s.id, 3000)).rejects.toThrow(
      `через ${HOLD_DAYS} дн.`,
    );
    await prisma.submission.update({
      where: { id: s.id },
      data: { decidedAt: new Date(Date.now() - HOLD_DAYS * DAY - 1000) },
    });
    expect((await submissions.listHoldDue()).map((x) => x.id)).toEqual([s.id]);

    // лайки при итоге не ввели — остаются зафиксированные при одобрении; оплата — за 1000 при одобрении
    expect(await submissions.finalizeViews(s.id, 3000)).toMatchObject({
      views: 3000,
      likes: 40,
      payoutMinor: 10_000,
    });
    await expect(submissions.finalizeViews(s.id, 5000)).rejects.toThrow(
      'уже зафиксирован',
    );
    expect(await submissions.listHoldDue()).toEqual([]);
  });

  it('оценка — только своему одобренному ролику и один раз', async () => {
    const [adv, other, a] = [await user(), await user(), await user()];
    const order = await orderWith(adv.id, 10_000);
    const s = await sent(order.id, a.id, 1000);
    const feedback = { rating: 5, review: null, portfolioAllowed: true };
    await expect(submissions.rate(s.id, adv.id, feedback)).rejects.toThrow(
      'уже оценён',
    );
    await submissions.moderatorApprove(s.id, 1n, 1000);
    await expect(submissions.rate(s.id, other.id, feedback)).rejects.toThrow(
      'не ваш',
    );
    await submissions.rate(s.id, adv.id, feedback);
    await expect(submissions.rate(s.id, adv.id, feedback)).rejects.toThrow(
      'уже оценён',
    );
  });
});

describe('баланс и вывод', () => {
  const WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  /** Креатор с кошельком в профиле — без него вывести нельзя. */
  async function creatorWithWallet() {
    const creator = await user();
    return prisma.user.update({
      where: { id: creator.id },
      data: { payoutWallet: WALLET },
    });
  }

  /** Одобренный ролик креатора на `views` просмотров (100 USDT за 1000), ещё в холде. */
  async function approved(creatorId: number, views: number) {
    const order = await openOrder((await user()).id);
    const s = await submissions.claim(order.id, creatorId);
    await submissions.attachVideo(s.id, creatorId, videoUrl(), views);
    await submissions.moderatorApprove(s.id, 1n, views);
    return s;
  }

  /** Холд прошёл — сдвигаем одобрение в прошлое на срок холда. */
  const holdOver = (submissionId: number) =>
    prisma.submission.update({
      where: { id: submissionId },
      data: { decidedAt: new Date(Date.now() - HOLD_DAYS * DAY - 1000) },
    });

  /** Одобренный ролик с зафиксированным итогом — деньги вышли из холда. */
  async function earned(creatorId: number, views: number) {
    const s = await approved(creatorId, views);
    await holdOver(s.id);
    await submissions.finalizeViews(s.id, views);
  }

  it('холд: начисленное до итога просмотров не выводится, после итога — доступно', async () => {
    const creator = await creatorWithWallet();
    const s = await approved(creator.id, 5000); // 500 USDT
    expect(await payouts.balance(creator.id)).toMatchObject({
      earnedMinor: 50_000,
      heldMinor: 50_000,
      availableMinor: 0,
    });
    expect(
      (await payouts.balance(creator.id)).nextReleaseAt!.getTime(),
    ).toBeGreaterThan(Date.now() + (HOLD_DAYS - 1) * DAY);
    await expect(payouts.requestPayout(creator.id, 10_000)).rejects.toThrow(
      'больше доступного',
    );

    await holdOver(s.id);
    await submissions.finalizeViews(s.id, 5000);
    expect(await payouts.balance(creator.id)).toMatchObject({
      heldMinor: 0,
      availableMinor: 50_000,
      nextReleaseAt: null,
    });
  });

  it('публикацию удалили до итога — начисление отменено, деньги вернулись в фонд', async () => {
    const creator = await creatorWithWallet();
    const s = await approved(creator.id, 5000);
    const { orderId } = s;
    const freeBefore = (
      await submissions.orderBudget(
        await prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      )
    ).free;

    const rejected = await submissions.publicationDeleted(s.id, 1n);
    expect(rejected).toMatchObject({
      status: 'MODERATOR_REJECTED',
      payoutMinor: 0,
      moderatorComment: PUBLICATION_DELETED,
    });
    expect(await payouts.balance(creator.id)).toMatchObject({
      earnedMinor: 0,
      heldMinor: 0,
    });
    const freeAfter = (
      await submissions.orderBudget(
        await prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      )
    ).free;
    expect(freeAfter - freeBefore).toBe(50_000);
    expect(await submissions.listHoldDue()).toEqual([]);

    // после итога деньги уже вышли из холда — отменить нельзя
    const done = await approved(creator.id, 5000);
    await holdOver(done.id);
    await submissions.finalizeViews(done.id, 5000);
    await expect(submissions.publicationDeleted(done.id, 1n)).rejects.toThrow(
      'вышли из холда',
    );
  });

  it('баланс — начисленное минус заявки; ролик на проверке не в балансе', async () => {
    const creator = await creatorWithWallet();
    await earned(creator.id, 5000); // 500 USDT
    const order = await openOrder((await user()).id);
    const pending = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(pending.id, creator.id, videoUrl(), 5000);
    expect(await payouts.balance(creator.id)).toEqual({
      earnedMinor: 50_000,
      heldMinor: 0,
      paidMinor: 0,
      requestedMinor: 0,
      availableMinor: 50_000,
      nextReleaseAt: null,
    });

    const p = await payouts.requestPayout(creator.id, 30_000);
    expect(p.wallet).toBe(WALLET);
    expect((await payouts.balance(creator.id)).availableMinor).toBe(20_000);
    await payouts.markPaid(p.id, 1n);
    expect(await payouts.balance(creator.id)).toMatchObject({
      paidMinor: 30_000,
      requestedMinor: 0,
      availableMinor: 20_000,
    });
  });

  it('больше баланса и вторую открытую заявку — нельзя; отказ возвращает сумму', async () => {
    const creator = await creatorWithWallet();
    await earned(creator.id, 5000);
    await expect(payouts.requestPayout(creator.id, 50_001)).rejects.toThrow(
      'больше доступного',
    );
    const p = await payouts.requestPayout(creator.id, 10_000);
    await expect(payouts.requestPayout(creator.id, 10_000)).rejects.toThrow(
      'уже есть заявка',
    );
    await payouts.reject(p.id, 1n, 'реквизиты не пришли');
    await expect(payouts.reject(p.id, 1n, 'ещё раз')).rejects.toThrow(
      'уже обработана',
    );
    expect((await payouts.balance(creator.id)).availableMinor).toBe(50_000);
    await expect(
      payouts.requestPayout(creator.id, 50_000),
    ).resolves.toBeDefined();
  });

  it('без кошелька — нельзя; смена кошелька не меняет поданную заявку', async () => {
    const creator = await user();
    await earned(creator.id, 5000);
    await expect(payouts.requestPayout(creator.id, 10_000)).rejects.toThrow(
      'кошелёк',
    );
    await profiles.updateWallet(creator.id, WALLET, false);
    const p = await payouts.requestPayout(creator.id, 10_000);
    await profiles.updateWallet(creator.id, null, true);
    expect(
      (await prisma.payout.findUnique({ where: { id: p.id } }))?.wallet,
    ).toBe(WALLET);
  });

  it('двойной тап — одна заявка', async () => {
    const creator = await creatorWithWallet();
    await earned(creator.id, 5000);
    const results = await Promise.allSettled([
      payouts.requestPayout(creator.id, 40_000),
      payouts.requestPayout(creator.id, 40_000),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.payout.count()).toBe(1);
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

  it('можно, если слот сгорел без видео', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.expireSlot(s.id);

    await orders.remove(order.id, advertiser.id);
    expect(await prisma.order.count()).toBe(0);
  });

  it('нельзя, если по заказу уже сдавали видео', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);

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
  it('считает заказы, видео, пользователей, оборот, выручку и причины отклонений за период', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const accepted = await openOrder(advertiser.id);
    const s = await submissions.claim(accepted.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), 30_000);
    await submissions.moderatorApprove(s.id, 1n, 30_000);

    for (const comment of ['мало', 'мало', 'брак']) {
      const r = await submissions.claim(accepted.id, creator.id);
      await submissions.attachVideo(r.id, creator.id, videoUrl(), VIEWS);
      await submissions.moderatorReject(r.id, 1n, comment);
    }

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
      videos: { submitted: 4, accepted: 1, pending: 0, moderatorRejected: 3 },
      users: { new: 2, activeAdvertisers: 1, activeCreators: 1 },
      turnover: { amount: 3000, fee: 750 }, // комиссия 20%: 3000 / 0,8 − 3000
      rejectReasons: [
        { reason: 'мало', count: 2 },
        { reason: 'брак', count: 1 },
      ],
    });
    expect((await analytics.funnel()).orders.moderationHours).toBe(0);

    // период, в который ничего не попало
    const future = await analytics.funnel(new Date(Date.now() + DAY));
    expect(future.orders.created).toBe(0);
    expect(future.turnover.amount).toBe(0);
    expect(future.orders.moderationHours).toBeNull();
  });
});

describe('бизнес-метрики', () => {
  it('вложено, освоение завершённых, повторные клиенты и долг креаторам', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const done = await openOrder(advertiser.id);
    const s = await submissions.claim(done.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), 30_000);
    await submissions.moderatorApprove(s.id, 1n, 30_000); // креатору 3000 USDT
    // итог зафиксирован — деньги вышли из холда, можно подать заявку
    await prisma.submission.update({
      where: { id: s.id },
      data: { decidedAt: new Date(Date.now() - HOLD_DAYS * DAY - 1000) },
    });
    await submissions.finalizeViews(s.id, 30_000);
    await orders.close(done.id, advertiser.id);
    await openOrder(advertiser.id);

    await prisma.user.update({
      where: { id: creator.id },
      data: { payoutWallet: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
    });
    await payouts.requestPayout(creator.id, 100_000); // 1000 USDT

    expect((await analytics.funnel()).business).toEqual({
      placed: 100_000,
      avgBudget: 50_000,
      utilization: 8, // 3000 / 0,8 = 3750 из 50 000
      finished: 1,
      underused: 1,
      firstClaimHours: 0,
      advertisers: { total: 1, repeat: 1 },
      creators: { total: 1, repeat: 0 },
      debt: { owed: 3000, requested: 1000 },
    });
  });
});

describe('что работает', () => {
  it('срезы по требованиям заказа и аудитория по кабинету и делам', async () => {
    const [advertiser, creator, idle] = [
      await user(),
      await user(),
      await user(),
    ];
    await prisma.user.update({
      where: { id: creator.id },
      data: { cabinet: 'CREATOR' },
    });
    const order = await openOrder(advertiser.id);
    await orders.markViewed(order.id, creator.id);
    await orders.markViewed(order.id, idle.id);
    const ok = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(ok.id, creator.id, videoUrl(), VIEWS);
    await submissions.moderatorApprove(ok.id, 1n, VIEWS);
    const bad = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(bad.id, creator.id, videoUrl(), VIEWS);
    await submissions.moderatorReject(bad.id, 1n, 'брак');
    // требования — после сдачи: ссылки тестовых роликов ни к какой площадке не относятся
    await prisma.order.update({
      where: { id: order.id },
      data: { platforms: ['TIKTOK', 'YOUTUBE'], maxDurationSec: 30 },
    });
    await pendingOrder(advertiser.id); // не опубликован — в срезы не идёт

    const w = await analytics.whatWorks();
    const row = { orders: 1, takeRate: 50, avgViews: VIEWS, approveRate: 50 };
    expect(w.slices).toEqual({
      category: [{ key: 'OTHER', ...row }],
      platform: [
        { key: 'TIKTOK', ...row },
        { key: 'YOUTUBE', ...row },
      ],
      orientation: [{ key: 'ANY', ...row }],
      duration: [{ key: '30', ...row }],
      cpm: [{ key: '100', ...row }],
    });
    expect(w.audience).toEqual(
      expect.arrayContaining([
        { cabinet: null, activity: 'orders', count: 1 },
        { cabinet: 'CREATOR', activity: 'videos', count: 1 },
        { cabinet: null, activity: 'none', count: 1 },
      ]),
    );
    expect(w.audience).toHaveLength(3);

    const future = await analytics.whatWorks(new Date(Date.now() + DAY));
    expect(future.slices.category).toEqual([]);
    expect(future.audience).toEqual([]);
  });
});

describe('профиль креатора', () => {
  /** Ролик креатора одобрен модератором, оценки ещё нет. */
  async function approvedVideo(advertiserId: number, creatorId: number) {
    const order = await openOrder(advertiserId);
    const s = await submissions.claim(order.id, creatorId);
    await submissions.attachVideo(
      s.id,
      creatorId,
      `https://v.example/${s.id}`,
      VIEWS,
    );
    await submissions.moderatorApprove(s.id, 1n, VIEWS);
    return s;
  }

  /** Ролик креатора одобрен, рекламодатель оставил отзыв, модератор его опубликовал. */
  async function acceptedVideo(
    advertiserId: number,
    creatorId: number,
    rating: number,
    portfolioAllowed = false,
  ) {
    const s = await approvedVideo(advertiserId, creatorId);
    await submissions.rate(s.id, advertiserId, {
      rating,
      review: `отзыв ${rating}`,
      portfolioAllowed,
    });
    await submissions.approveReview(s.id);
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
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);

    // видео ещё у модератора — рекламодатель его не видел
    expect(await profiles.canView(advertiser, creator.id, false)).toBe(false);
    await submissions.moderatorApprove(s.id, 1n, VIEWS);
    expect(await profiles.canView(advertiser, creator.id, false)).toBe(true);

    expect(await profiles.canView(creator, creator.id, false)).toBe(true);
    expect(await profiles.canView(stranger, creator.id, true)).toBe(true);
    expect(await profiles.canView(stranger, creator.id, false)).toBe(false);
  });

  it('рекламодателю — буква имени и код, без имени, @username и соцсетей', async () => {
    const creator = await prisma.user.create({
      data: {
        telegramId: nextTelegramId++,
        username: 'secret_creator',
        firstName: 'Аня',
        socialLinks: ['https://www.tiktok.com/@secret_creator'],
      },
    });
    await acceptedVideo((await user()).id, creator.id, 5, true);

    const forAdvertiser = await profiles.profile(creator.id, false);
    expect(forAdvertiser.name).toMatch(/^Креатор А\. · \w{4}$/);
    // портфолио — только названия работ: ссылка обычно ведёт на аккаунт креатора
    expect(forAdvertiser.portfolio).toHaveLength(1);
    expect(forAdvertiser.portfolio[0].videoUrl).toBeNull();
    expect(forAdvertiser.links).toEqual([]);
    expect(JSON.stringify(forAdvertiser)).not.toContain('secret_creator');

    const full = await profiles.profile(creator.id, true);
    expect(full.name).toBe('@secret_creator');
    expect(full.links[0]).toContain('secret_creator');
    expect(full.portfolio[0].videoUrl).not.toBeNull();
  });

  it('рекламодателю — названия только его заказов, чужие скрыты', async () => {
    const [mine, other, creator] = [await user(), await user(), await user()];
    await acceptedVideo(mine.id, creator.id, 5, true);
    await acceptedVideo(other.id, creator.id, 4, true);

    const forMine = await profiles.profile(creator.id, false, mine.id);
    const titles = (list: { orderTitle: string | null }[]) =>
      list.map((x) => x.orderTitle).sort();
    expect(titles(forMine.reviews)).toEqual(['Заказ', null].sort());
    expect(titles(forMine.portfolio)).toEqual(['Заказ', null].sort());
    // креатору и модератору — все названия
    expect(titles((await profiles.profile(creator.id, true)).reviews)).toEqual([
      'Заказ',
      'Заказ',
    ]);
  });

  it('отзыв с текстом — в профиле только после проверки, звёзды без текста — сразу', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const s = await approvedVideo(advertiser.id, creator.id);
    const rated = await submissions.rate(s.id, advertiser.id, {
      rating: 2,
      review: 'пишите мне в личку',
      portfolioAllowed: false,
    });
    expect(rated.reviewQueuedAt).not.toBeNull();

    expect(await profiles.profile(creator.id, true)).toMatchObject({
      rating: null,
      reviewsCount: 0,
      reviews: [],
    });
    expect((await submissions.listPendingReviews()).map((r) => r.id)).toContain(
      s.id,
    );
    // креатор ещё не видел отзыв — пожаловаться не на что
    await expect(
      reports.create(
        creator,
        reports.parse({ target: 'REVIEW', targetId: s.id, reason: 'INSULT' }),
      ),
    ).rejects.toThrow('Не найдено');

    await submissions.approveReview(s.id);
    expect(await profiles.profile(creator.id, true)).toMatchObject({
      rating: 2,
      reviewsCount: 1,
    });
    // второй модератор не опубликует повторно
    await expect(submissions.approveReview(s.id)).rejects.toThrow('проверен');

    const starsOnly = await approvedVideo(advertiser.id, creator.id);
    const noText = await submissions.rate(starsOnly.id, advertiser.id, {
      rating: 4,
      review: null,
      portfolioAllowed: false,
    });
    expect(noText.reviewQueuedAt).toBeNull();
    expect(await profiles.profile(creator.id, true)).toMatchObject({
      rating: 3,
      reviewsCount: 2,
    });
  });

  it('модератор отклоняет отзыв с проверки — оценка не попадает в рейтинг', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const s = await approvedVideo(advertiser.id, creator.id);
    await submissions.rate(s.id, advertiser.id, {
      rating: 1,
      review: 'ужас',
      portfolioAllowed: false,
    });

    await submissions.removeReview(s.id);

    expect(await submissions.listPendingReviews()).toHaveLength(0);
    expect(await profiles.profile(creator.id, true)).toMatchObject({
      rating: null,
      completed: 1,
    });
  });

  it('модератор удаляет отзыв — одобрение и счётчик выполненных остаются', async () => {
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

  it('на закрытый заказ — только тот, кто по нему работал: перебором id не узнать, какие заказы есть', async () => {
    const [advertiser, worked, stranger] = [
      await user(),
      await user(),
      await user(),
    ];
    const order = await openOrder(advertiser.id);
    await submissions.claim(order.id, worked.id);
    await orders.close(order.id, advertiser.id);

    await expect(
      reports.create(stranger, report('ORDER', order.id)),
    ).rejects.toThrow('Не найдено');
    await expect(
      reports.create(worked, report('ORDER', order.id)),
    ).resolves.toContain('заказ');
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
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);

    await expect(
      reports.create(advertiser, report('VIDEO', s.id, 'STOLEN')),
    ).rejects.toThrow('Не найдено');
    await submissions.moderatorApprove(s.id, 1n, VIEWS);
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
    const inWork = await submissions.claim(order.id, c1.id);
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
    // начатый ролик по снятому заказу не сдать — слот сгорел
    await expect(
      submissions.attachVideo(inWork.id, c1.id, videoUrl(), VIEWS),
    ).rejects.toThrow('обработан');
    await expect(
      reports.resolve({ target: 'ORDER', targetId: order.id }, false, 2n),
    ).rejects.toThrow('уже рассмотрены');
  });

  it('мера по уже закрытому заказу убирает ссылку на товар — /r/ больше не ведёт на неё', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { targetUrl: 'https://phish.example' },
    });
    const { trackCode } = await submissions.claim(order.id, creator.id);
    await reports.create(creator, report('ORDER', order.id));
    await orders.close(order.id, advertiser.id);
    expect(await submissions.click(trackCode!)).toBe('https://phish.example');

    const { closedOrder } = await reports.resolve(
      { target: 'ORDER', targetId: order.id },
      true,
      1n,
    );
    expect(closedOrder).toBeNull(); // уже был закрыт — уведомлять о закрытии некого
    expect(await submissions.click(trackCode!)).toBeNull();
  });

  it('мера по истёкшему заказу закрывает его — продлением не вернуть', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    await reports.create(creator, report('ORDER', order.id));
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'EXPIRED' },
    });

    const { closedOrder } = await reports.resolve(
      { target: 'ORDER', targetId: order.id },
      true,
      1n,
    );
    expect(closedOrder?.status).toBe('CLOSED');
    await expect(orders.extend(order.id, advertiser.id, 7)).rejects.toThrow();
    expect(await statusOf(order.id)).toBe('CLOSED');
  });

  it('мера по замороженному заказу: закрытие рекламодателем не возвращает снятую ссылку', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { targetUrl: 'https://phish.example' },
    });
    const { trackCode } = await submissions.claim(order.id, creator.id);
    await reports.create(creator, report('ORDER', order.id));
    await orders.update(order.id, advertiser.id, {
      title: 'Новое',
      description: 'Новое описание',
      budgetMinor: BUDGET,
      minViews: 250,
      category: 'OTHER',
    });

    await reports.resolve({ target: 'ORDER', targetId: order.id }, true, 1n);
    await orders.close(order.id, advertiser.id);
    expect(await statusOf(order.id)).toBe('CLOSED');
    expect(await submissions.click(trackCode!)).toBeNull();
  });

  it('мера не применилась — жалобы остаются открытыми', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    await reports.create(creator, report('ORDER', order.id));
    jest
      .spyOn(orders, 'moderatorClose')
      .mockRejectedValueOnce(new Error('сбой'));

    await expect(
      reports.resolve({ target: 'ORDER', targetId: order.id }, true, 1n),
    ).rejects.toThrow('сбой');
    expect(await reports.listOpen()).toHaveLength(1);
    expect(await statusOf(order.id)).toBe('OPEN');
  });

  it('жалоба на отзыв: пишет только тот, о ком отзыв; мера удаляет отзыв', async () => {
    const [advertiser, creator] = [await user(), await user()];
    const order = await openOrder(advertiser.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
    await submissions.moderatorApprove(s.id, 1n, VIEWS);
    await submissions.rate(s.id, advertiser.id, {
      rating: 1,
      review: 'ужас',
      portfolioAllowed: false,
    });
    await submissions.approveReview(s.id);

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
  it('изменённый заказ на проверке снят — чужие ролики на проверке отклонены, резерв вернулся', async () => {
    const [banned, creator] = [await user(), await user()];
    const order = await openOrder(banned.id);
    const s = await submissions.claim(order.id, creator.id);
    await submissions.attachVideo(s.id, creator.id, videoUrl(), VIEWS);
    await orders.update(order.id, banned.id, {
      title: 'Новое',
      description: 'Описание',
      budgetMinor: BUDGET,
      minViews: 250,
      category: 'OTHER',
    });

    await bans.ban(banned.id, 'мошенничество');

    expect(await statusOf(order.id)).toBe('REJECTED');
    expect(
      await prisma.submission.findUniqueOrThrow({ where: { id: s.id } }),
    ).toMatchObject({ status: 'MODERATOR_REJECTED', payoutMinor: 0 });
  });

  it('закрывает заказы, отклоняет ожидающие модерации, убирает отклики без видео', async () => {
    const [banned, other, creator] = [await user(), await user(), await user()];
    // заказы заблокированного: открытый (с откликом другого креатора) и на модерации
    const open = await openOrder(banned.id);
    const pending = await pendingOrder(banned.id);
    const onBannedOrder = await submissions.claim(open.id, creator.id);
    // отклики заблокированного как креатора: без видео, у модератора, у рекламодателя
    const otherOrder = await openOrder(other.id);
    await submissions.claim(otherOrder.id, banned.id);
    const [o2, o3] = [await openOrder(other.id), await openOrder(other.id)];
    const atModerator = await submissions.claim(o2.id, banned.id);
    await submissions.attachVideo(atModerator.id, banned.id, videoUrl(), VIEWS);
    const atAdvertiser = await submissions.claim(o3.id, banned.id);
    await submissions.attachVideo(
      atAdvertiser.id,
      banned.id,
      videoUrl(),
      VIEWS,
    );
    await submissions.moderatorApprove(atAdvertiser.id, 1n, VIEWS);

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
    // по закрытому заказу заблокированного ролик уже не сдать
    expect((await submissions.findById(onBannedOrder.id))?.status).toBe(
      'SLOT_EXPIRED',
    );
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

  it('по жалобе: мера и бан автора; модератора не забанить; уже забаненного — не повторно', async () => {
    const [advertiser, c1, c2] = [await user(), await user(), await user()];
    const order = await openOrder(advertiser.id);
    const inWork = await submissions.claim(order.id, c2.id);
    await reports.create(
      c1,
      reports.parse({ target: 'ORDER', targetId: order.id, reason: 'FRAUD' }),
    );

    const res = await bans.resolveReports(
      {
        group: { target: 'ORDER', targetId: order.id },
        actioned: true,
        banReason: 'мошенничество',
      },
      1n,
    );
    expect(res.reporters).toEqual([c1.telegramId]);
    expect(res.closedOrder?.id).toBe(order.id);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: advertiser.id } }))
        .bannedAt,
    ).not.toBeNull();
    expect((await submissions.findById(inWork.id))?.status).toBe(
      'SLOT_EXPIRED',
    );

    const moderator = await prisma.user.create({ data: { telegramId: 777n } });
    await expect(bans.banUser(moderator.id, 'спам')).rejects.toThrow(
      'Модератора',
    );
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
