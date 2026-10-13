import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, SubmissionStatus } from '@prisma/client';
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
}
