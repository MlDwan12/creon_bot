import { Injectable, NotFoundException } from '@nestjs/common';
import { SubmissionStatus, type User } from '@prisma/client';
import { creatorLabel, publicName } from '../common/format';
import { PrismaService } from '../prisma/prisma.service';
import { NO_LINKS, type ProfileLinks } from './profile-input';

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
        status: SubmissionStatus.MODERATOR_APPROVED,
      },
      select: { id: true },
    });
    return shared !== null;
  }

  /**
   * `full` — для самого креатора и модератора: @username и соцсети. Остальным (рекламодателю) —
   * только имя: контакты сторон друг другу не показываем, всё общение — через площадку.
   */
  async profile(creatorId: number, full: boolean) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });
    if (!creator) throw new NotFoundException('Креатор не найден');

    const accepted = {
      creatorId,
      status: SubmissionStatus.MODERATOR_APPROVED,
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
      name: full ? creatorLabel(creator) : publicName(creator),
      rating: avg === null ? null : Math.round(avg * 10) / 10,
      reviewsCount: ratings._count.rating,
      completed,
      /** Блокировка — показывать только модераторам (см. ProfilesController). */
      ban: creator.bannedAt
        ? { at: creator.bannedAt, reason: creator.banReason }
        : null,
      links: full
        ? {
            tiktokUrl: creator.tiktokUrl,
            youtubeUrl: creator.youtubeUrl,
            vkUrl: creator.vkUrl,
            instagramUrl: creator.instagramUrl,
            xUrl: creator.xUrl,
          }
        : NO_LINKS,
      /** Кошелёк для выплат — только самому креатору и модератору. */
      wallet: full ? creator.payoutWallet : null,
      reviews: reviews.map((s) => ({
        submissionId: s.id,
        rating: s.rating!,
        review: s.review,
        orderTitle: s.order.title,
        decidedAt: s.decidedAt,
      })),
      // ссылка на видео обычно ведёт на аккаунт креатора — рекламодателю только название работы
      portfolio: portfolio.map((s) => ({
        submissionId: s.id,
        videoUrl: full ? s.videoUrl : null,
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

  updateLinks(userId: number, links: ProfileLinks) {
    return this.prisma.user.update({ where: { id: userId }, data: links });
  }

  updateWallet(userId: number, payoutWallet: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { payoutWallet },
    });
  }
}
