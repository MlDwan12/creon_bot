import { Injectable, NotFoundException } from '@nestjs/common';
import { SubmissionStatus, type User } from '@prisma/client';
import { creatorLabel } from '../bot/utils/format';
import { PrismaService } from '../prisma/prisma.service';

/** Сколько последних отзывов и видео портфолио показывать в профиле. */
const PROFILE_LIST_LIMIT = 20;

/** Профиль креатора: рейтинг, выполненные заказы, отзывы, портфолио, ссылки на соцсети. */
@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Профиль видят сам креатор, модератор и рекламодатель, до которого дошло видео этого креатора
   * (одобрено модератором). Публичного каталога креаторов нет.
   */
  async canView(viewer: User, creatorId: number, isModerator: boolean) {
    if (viewer.id === creatorId || isModerator) return true;
    const shared = await this.prisma.submission.findFirst({
      where: {
        creatorId,
        order: { advertiserId: viewer.id },
        status: {
          in: [
            SubmissionStatus.MODERATOR_APPROVED,
            SubmissionStatus.ADVERTISER_APPROVED,
            SubmissionStatus.ADVERTISER_REJECTED,
          ],
        },
      },
      select: { id: true },
    });
    return shared !== null;
  }

  async profile(creatorId: number) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });
    if (!creator) throw new NotFoundException('Креатор не найден');

    const accepted = {
      creatorId,
      status: SubmissionStatus.ADVERTISER_APPROVED,
    };
    const [ratings, completed, reviews, portfolio] = await Promise.all([
      this.prisma.submission.aggregate({
        where: { creatorId, rating: { not: null } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.submission.count({ where: accepted }),
      this.prisma.submission.findMany({
        where: { creatorId, rating: { not: null } },
        orderBy: { decidedAt: 'desc' },
        take: PROFILE_LIST_LIMIT,
        include: { order: { select: { title: true } } },
      }),
      this.prisma.submission.findMany({
        where: { ...accepted, portfolioAllowed: true },
        orderBy: { decidedAt: 'desc' },
        take: PROFILE_LIST_LIMIT,
        include: { order: { select: { title: true } } },
      }),
    ]);

    const avg = ratings._avg.rating;
    return {
      id: creator.id,
      name: creatorLabel(creator),
      rating: avg === null ? null : Math.round(avg * 10) / 10,
      reviewsCount: ratings._count.rating,
      completed,
      links: {
        tiktokUrl: creator.tiktokUrl,
        youtubeUrl: creator.youtubeUrl,
        vkUrl: creator.vkUrl,
      },
      reviews: reviews.map((s) => ({
        submissionId: s.id,
        rating: s.rating!,
        review: s.review,
        orderTitle: s.order.title,
        decidedAt: s.decidedAt,
      })),
      portfolio: portfolio.map((s) => ({
        submissionId: s.id,
        videoUrl: s.videoUrl,
        orderTitle: s.order.title,
      })),
    };
  }

  async telegramIdOf(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    return user?.telegramId ?? null;
  }

  updateLinks(
    userId: number,
    links: {
      tiktokUrl: string | null;
      youtubeUrl: string | null;
      vkUrl: string | null;
    },
  ) {
    return this.prisma.user.update({ where: { id: userId }, data: links });
  }
}
