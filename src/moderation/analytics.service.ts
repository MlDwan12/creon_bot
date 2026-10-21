import { Injectable } from '@nestjs/common';
import {
  Cabinet,
  OrderCategory,
  OrderStatus,
  Prisma,
  SubmissionStatus,
  VideoOrientation,
  VideoPlatform,
} from '@prisma/client';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Воронка площадки для модераторов: заказы, видео, пользователи за период.
 * `since` не задан — за всё время. Заказы попадают в период по дате создания, видео — по дате отправки.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async funnel(since?: Date) {
    const created = since ? { gte: since } : undefined;
    const order = { createdAt: created };
    const epoch = since ?? new Date(0);

    const [
      ordersCreated,
      published,
      rejected,
      withClaims,
      withVideos,
      withAccepted,
      videosSubmitted,
      videosByStatus,
      newUsers,
      [advertisers],
      [creators],
      [timing],
      [turnover],
      rejectReasons,
      business,
    ] = await Promise.all([
      this.prisma.order.count({ where: order }),
      this.prisma.order.count({
        where: {
          ...order,
          status: {
            in: [OrderStatus.OPEN, OrderStatus.CLOSED, OrderStatus.EXPIRED],
          },
        },
      }),
      this.prisma.order.count({
        where: { ...order, status: OrderStatus.REJECTED },
      }),
      this.prisma.order.count({
        where: { ...order, submissions: { some: {} } },
      }),
      this.prisma.order.count({
        where: { ...order, submissions: { some: { videoUrl: { not: null } } } },
      }),
      this.prisma.order.count({
        where: {
          ...order,
          submissions: {
            some: { status: SubmissionStatus.MODERATOR_APPROVED },
          },
        },
      }),
      this.prisma.submission.count({
        where: { submittedAt: since ? { gte: since } : { not: null } },
      }),
      this.prisma.submission.groupBy({
        by: ['status'],
        where: { submittedAt: since ? { gte: since } : { not: null } },
        _count: true,
      }),
      this.prisma.user.count({ where: { createdAt: created } }),
      // считает база: id всех активных в память не тянем
      this.prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "advertiserId") AS n FROM "Order" WHERE "createdAt" >= ${epoch}`,
      ),
      this.prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "creatorId") AS n FROM "Submission" WHERE "createdAt" >= ${epoch}`,
      ),
      // Медиана, а не среднее: один заказ, забытый на неделю, не должен искажать картину.
      this.prisma.$queryRaw<{ hours: number | null }[]>(Prisma.sql`
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM "decidedAt" - "moderationRequestedAt")
        ) / 3600 AS hours
        FROM "Order"
        WHERE "decidedAt" IS NOT NULL AND "createdAt" >= ${epoch}`),
      // Оборот — сколько начислено креаторам за одобренные ролики; выручка — комиссия площадки
      // сверх этого, как в отчёте рекламодателю (budgetSpent в src/orders/budget.ts).
      this.prisma.$queryRaw<{ total: bigint | null; fee: bigint | null }[]>(
        Prisma.sql`
        SELECT sum(s."payoutMinor") AS total,
          sum(ceil(s."payoutMinor" * 100.0 / (100 - o."feePercent")) - s."payoutMinor")::bigint AS fee
        FROM "Submission" s JOIN "Order" o ON o.id = s."orderId"
        WHERE s.status = 'MODERATOR_APPROVED' AND s."submittedAt" >= ${epoch}`,
      ),
      // Причины — текстом: модератор выбирает готовую и может дописать, дописанная — отдельной строкой.
      this.prisma.submission.groupBy({
        by: ['moderatorComment'],
        where: {
          status: SubmissionStatus.MODERATOR_REJECTED,
          submittedAt: since ? { gte: since } : { not: null },
        },
        _count: true,
        orderBy: { _count: { moderatorComment: 'desc' } },
        take: 10,
      }),
      this.business(epoch),
    ]);

    const videos = (status: SubmissionStatus) =>
      videosByStatus.find((v) => v.status === status)?._count ?? 0;

    return {
      orders: {
        created: ordersCreated,
        published,
        rejected,
        withClaims,
        withVideos,
        withAccepted,
        moderationHours:
          timing.hours === null ? null : Math.round(timing.hours * 10) / 10,
      },
      videos: {
        submitted: videosSubmitted,
        pending: videos(SubmissionStatus.SUBMITTED),
        moderatorRejected: videos(SubmissionStatus.MODERATOR_REJECTED),
        accepted: videos(SubmissionStatus.MODERATOR_APPROVED),
      },
      users: {
        new: newUsers,
        activeAdvertisers: Number(advertisers.n),
        activeCreators: Number(creators.n),
      },
      turnover: {
        amount: fromMinor(Number(turnover.total ?? 0)),
        fee: fromMinor(Number(turnover.fee ?? 0)),
      },
      rejectReasons: rejectReasons.map((r) => ({
        reason: r.moderatorComment ?? '—',
        count: r._count,
      })),
      business,
    };
  }

  /**
   * Деньги, скорость и повторность за период (заказы — по дате создания, как в воронке) и долг
   * креаторам на сейчас. Деньги — USDT, со стороны рекламодателя (с комиссией), кроме долга.
   */
  private async business(epoch: Date) {
    const hours = (h: number | null) =>
      h === null ? null : Math.round(h * 10) / 10;
    const [
      [placed],
      [finished],
      [firstClaim],
      [advertisers],
      [creators],
      [debt],
    ] = await Promise.all([
      // Вложено рекламодателями — бюджеты опубликованных заказов.
      this.prisma.$queryRaw<{ budget: bigint | null; n: bigint }[]>(Prisma.sql`
          SELECT sum("budgetMinor") AS budget, count(*) AS n FROM "Order"
          WHERE status IN ('OPEN', 'CLOSED', 'EXPIRED') AND "createdAt" >= ${epoch}`),
      // Завершённые заказы: сколько бюджета освоено и сколько закрылось, освоив меньше половины.
      this.prisma.$queryRaw<
        {
          budget: bigint | null;
          spent: number | null;
          underused: bigint;
          n: bigint;
        }[]
      >(Prisma.sql`
          SELECT sum(o."budgetMinor") AS budget, sum(o.spent)::float8 AS spent,
            count(*) FILTER (WHERE o.spent < o."budgetMinor" * 0.5) AS underused, count(*) AS n
          FROM (
            SELECT o."budgetMinor",
              coalesce((SELECT sum(s."payoutMinor") FROM "Submission" s
                WHERE s."orderId" = o.id AND s.status = 'MODERATOR_APPROVED'), 0)
                * 100.0 / (100 - o."feePercent") AS spent
            FROM "Order" o
            WHERE o.status IN ('CLOSED', 'EXPIRED') AND o."createdAt" >= ${epoch}
          ) o`),
      // Медиана от публикации до первого отклика. После правки decidedAt сдвигается — не ниже 0.
      this.prisma.$queryRaw<{ hours: number | null }[]>(Prisma.sql`
          SELECT percentile_cont(0.5) WITHIN GROUP (
            ORDER BY greatest(0, extract(epoch FROM f.first - o."decidedAt"))
          ) / 3600 AS hours
          FROM "Order" o
          JOIN (SELECT "orderId", min("createdAt") AS first FROM "Submission" GROUP BY 1) f
            ON f."orderId" = o.id
          WHERE o."decidedAt" IS NOT NULL AND o."createdAt" >= ${epoch}`),
      // Рекламодатели с опубликованным заказом в периоде; повторные — с 2+ опубликованными за всё время.
      this.prisma.$queryRaw<{ total: bigint; repeat: bigint }[]>(Prisma.sql`
          SELECT count(*) AS total, count(*) FILTER (WHERE n >= 2) AS repeat FROM (
            SELECT count(*) AS n FROM "Order"
            WHERE status IN ('OPEN', 'CLOSED', 'EXPIRED')
            GROUP BY "advertiserId" HAVING max("createdAt") >= ${epoch}
          ) a`),
      // Креаторы с одобренным роликом в периоде; повторные — одобрены в 2+ заказах за всё время.
      this.prisma.$queryRaw<{ total: bigint; repeat: bigint }[]>(Prisma.sql`
          SELECT count(*) AS total, count(*) FILTER (WHERE n >= 2) AS repeat FROM (
            SELECT count(DISTINCT "orderId") AS n FROM "Submission"
            WHERE status = 'MODERATOR_APPROVED'
            GROUP BY "creatorId" HAVING max("submittedAt") >= ${epoch}
          ) c`),
      // Долг креаторам на сейчас: начислено − выплачено; из него в заявках на вывод.
      this.prisma.$queryRaw<
        {
          earned: bigint | null;
          paid: bigint | null;
          requested: bigint | null;
        }[]
      >(Prisma.sql`
          SELECT
            (SELECT sum("payoutMinor") FROM "Submission" WHERE status = 'MODERATOR_APPROVED') AS earned,
            (SELECT sum("amountMinor") FROM "Payout" WHERE status = 'PAID') AS paid,
            (SELECT sum("amountMinor") FROM "Payout" WHERE status = 'REQUESTED') AS requested`),
    ]);
    const placedBudget = Number(placed.budget ?? 0);
    const finishedBudget = Number(finished.budget ?? 0);
    return {
      placed: fromMinor(placedBudget),
      avgBudget: Number(placed.n)
        ? fromMinor(Math.round(placedBudget / Number(placed.n)))
        : null,
      /** Доля бюджета, освоенная завершёнными заказами, %; null — завершённых нет. */
      utilization: finishedBudget
        ? Math.round(((finished.spent ?? 0) / finishedBudget) * 100)
        : null,
      finished: Number(finished.n),
      underused: Number(finished.underused),
      firstClaimHours: hours(firstClaim.hours),
      advertisers: {
        total: Number(advertisers.total),
        repeat: Number(advertisers.repeat),
      },
      creators: {
        total: Number(creators.total),
        repeat: Number(creators.repeat),
      },
      debt: {
        owed: fromMinor(Number(debt.earned ?? 0) - Number(debt.paid ?? 0)),
        requested: fromMinor(Number(debt.requested ?? 0)),
      },
    };
  }

  /**
   * «Что работает»: опубликованные за период заказы (по дате создания), разложенные по требованиям
   * и ставке, и пользователи (зарегистрированные за период) по кабинету и тому, что они делали.
   */
  async whatWorks(since?: Date) {
    const epoch = since ?? new Date(0);
    const [rows, audience] = await Promise.all([
      // cpmMinor ставит модератор при одобрении — так отбираем заказы, которые видели креаторы.
      this.prisma.$queryRaw<OrderRow[]>(Prisma.sql`
        SELECT o.category, o.orientation, o.platforms::text[] AS platforms,
          o."maxDurationSec", o."cpmMinor",
          (SELECT count(*) FROM "OrderView" v WHERE v."orderId" = o.id)::int AS opened,
          (SELECT count(DISTINCT "creatorId") FROM "Submission" s WHERE s."orderId" = o.id)::int AS taken,
          (SELECT count(*) FROM "Submission" s
            WHERE s."orderId" = o.id AND s.status = 'MODERATOR_APPROVED')::int AS approved,
          (SELECT count(*) FROM "Submission" s
            WHERE s."orderId" = o.id AND s.status = 'MODERATOR_REJECTED')::int AS rejected,
          (SELECT coalesce(sum(views), 0) FROM "Submission" s
            WHERE s."orderId" = o.id AND s.status = 'MODERATOR_APPROVED')::int AS views
        FROM "Order" o
        WHERE o."cpmMinor" IS NOT NULL AND o."createdAt" >= ${epoch}`),
      this.prisma.$queryRaw<
        {
          cabinet: Cabinet | null;
          ordered: boolean;
          submitted: boolean;
          n: number;
        }[]
      >(Prisma.sql`
        SELECT u.cabinet,
          EXISTS (SELECT 1 FROM "Order" o WHERE o."advertiserId" = u.id) AS ordered,
          EXISTS (SELECT 1 FROM "Submission" s
            WHERE s."creatorId" = u.id AND s."submittedAt" IS NOT NULL) AS submitted,
          count(*)::int AS n
        FROM "User" u WHERE u."createdAt" >= ${epoch}
        GROUP BY 1, 2, 3`),
    ]);
    return {
      minOrders: MIN_ORDERS,
      slices: {
        category: slice(rows, (o) => [o.category]),
        platform: slice(rows, (o) =>
          o.platforms.length ? o.platforms : [ANY],
        ),
        orientation: slice(rows, (o) => [o.orientation ?? ANY]),
        duration: slice(rows, (o) => [durationBucket(o.maxDurationSec)]),
        cpm: slice(rows, (o) => [String(fromMinor(o.cpmMinor))]),
      },
      audience: audience.map((a) => ({
        cabinet: a.cabinet,
        activity:
          a.ordered && a.submitted
            ? 'both'
            : a.ordered
              ? 'orders'
              : a.submitted
                ? 'videos'
                : 'none',
        count: a.n,
      })),
    };
  }
}

/** Срезы, где заказов меньше, клиент показывает серыми — «мало данных». */
const MIN_ORDERS = 5;
/** Требование не задано: любая площадка, ориентация, длительность. */
const ANY = 'ANY';

interface OrderRow {
  category: OrderCategory;
  orientation: VideoOrientation | null;
  platforms: VideoPlatform[];
  maxDurationSec: number | null;
  cpmMinor: number;
  opened: number;
  taken: number;
  approved: number;
  rejected: number;
  views: number;
}

/** По верхней границе длительности из требований: настоящую длину ролика мы не знаем. */
function durationBucket(max: number | null) {
  if (max === null) return ANY;
  if (max <= 15) return '15';
  if (max <= 30) return '30';
  if (max <= 60) return '60';
  return 'LONG';
}

/**
 * Метрики по значению признака. Заказ с несколькими значениями (площадки) идёт в каждое.
 * takeRate — креаторов взяли / открыли карточку, %; approveRate — одобрено из решённых, %.
 */
function slice(rows: OrderRow[], keys: (o: OrderRow) => string[]) {
  const groups = new Map<string, OrderRow[]>();
  for (const o of rows)
    for (const k of keys(o)) groups.set(k, [...(groups.get(k) ?? []), o]);
  const sum = (os: OrderRow[], f: (o: OrderRow) => number) =>
    os.reduce((n, o) => n + f(o), 0);
  const percent = (part: number, whole: number) =>
    whole ? Math.round((part / whole) * 100) : null;
  return [...groups]
    .map(([key, os]) => {
      const approved = sum(os, (o) => o.approved);
      return {
        key,
        orders: os.length,
        takeRate: percent(
          sum(os, (o) => o.taken),
          sum(os, (o) => o.opened),
        ),
        avgViews: approved
          ? Math.round(sum(os, (o) => o.views) / approved)
          : null,
        approveRate: percent(approved, approved + sum(os, (o) => o.rejected)),
      };
    })
    .sort((a, b) => b.orders - a.orders);
}
