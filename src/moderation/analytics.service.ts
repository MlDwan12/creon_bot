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
    };
  }
}
