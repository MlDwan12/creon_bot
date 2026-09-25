import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { kopecksToRubles } from '../common/money';
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
      advertisers,
      creators,
      [timing],
      [turnover],
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
            some: { status: SubmissionStatus.ADVERTISER_APPROVED },
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
      this.prisma.order.findMany({
        where: order,
        distinct: ['advertiserId'],
        select: { advertiserId: true },
      }),
      this.prisma.submission.findMany({
        where: { createdAt: created },
        distinct: ['creatorId'],
        select: { creatorId: true },
      }),
      // Медиана, а не среднее: один заказ, забытый на неделю, не должен искажать картину.
      this.prisma.$queryRaw<{ hours: number | null }[]>(Prisma.sql`
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM "decidedAt" - "moderationRequestedAt")
        ) / 3600 AS hours
        FROM "Order"
        WHERE "decidedAt" IS NOT NULL AND "createdAt" >= ${epoch}`),
      // Оборот — сумма цен принятых видео (договорные не считаются): база для будущей комиссии.
      this.prisma.$queryRaw<{ kopecks: bigint | null; priced: bigint }[]>(
        Prisma.sql`
        SELECT sum(o."priceKopecks") AS kopecks, count(o."priceKopecks") AS priced
        FROM "Submission" s JOIN "Order" o ON o.id = s."orderId"
        WHERE s.status = 'ADVERTISER_APPROVED' AND s."submittedAt" >= ${epoch}`,
      ),
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
        pending:
          videos(SubmissionStatus.SUBMITTED) +
          videos(SubmissionStatus.MODERATOR_APPROVED),
        moderatorRejected: videos(SubmissionStatus.MODERATOR_REJECTED),
        accepted: videos(SubmissionStatus.ADVERTISER_APPROVED),
        advertiserRejected: videos(SubmissionStatus.ADVERTISER_REJECTED),
      },
      users: {
        new: newUsers,
        activeAdvertisers: advertisers.length,
        activeCreators: creators.length,
      },
      turnover: {
        rubles: kopecksToRubles(Number(turnover.kopecks ?? 0)),
        acceptedPriced: Number(turnover.priced),
      },
    };
  }
}
