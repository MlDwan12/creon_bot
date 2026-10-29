import { tr } from '../i18n/request-lang';
import { Injectable, NotFoundException } from '@nestjs/common';
import { type Cabinet, SubmissionStatus, type User } from '@prisma/client';
import { creatorLabel, publicName } from '../common/format';
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
        status: SubmissionStatus.MODERATOR_APPROVED,
      },
      select: { id: true },
    });
    return shared !== null;
  }

  /**
   * `full` — для самого креатора и модератора: @username и соцсети. Остальным (рекламодателю) —
   * только имя: контакты сторон друг другу не показываем, всё общение — через площадку. Названия
   * заказов рекламодателю — только его собственных (`viewerId`): чужие — дело других рекламодателей.
   */
  async profile(creatorId: number, full: boolean, viewerId?: number) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });
    if (!creator) throw new NotFoundException(tr('errors.creatorNotFound'));

    const accepted = {
      creatorId,
      status: SubmissionStatus.MODERATOR_APPROVED,
    };
    // отзыв с текстом виден только после проверки модератором
    const published = {
      creatorId,
      rating: { not: null },
      reviewQueuedAt: null,
    };
    const [ratings, completed, reviews, portfolio] = await Promise.all([
      this.prisma.submission.aggregate({
        where: published,
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.submission.count({ where: accepted }),
      this.prisma.submission.findMany({
        where: published,
        orderBy: { decidedAt: 'desc' },
        take: PROFILE_LIST_LIMIT,
        include: { order: { select: { title: true, advertiserId: true } } },
      }),
      this.prisma.submission.findMany({
        where: { ...accepted, portfolioAllowed: true },
        orderBy: { decidedAt: 'desc' },
        take: PROFILE_LIST_LIMIT,
        include: { order: { select: { title: true, advertiserId: true } } },
      }),
    ]);
    const titleOf = (order: { title: string; advertiserId: number }) =>
      full || order.advertiserId === viewerId ? order.title : null;

    const avg = ratings._avg.rating;
    return {
      id: creator.id,
      name: full ? creatorLabel(creator) : publicName(creator),
      rating: avg === null ? null : Math.round(avg * 10) / 10,
      reviewsCount: ratings._count.rating,
      completed,
      /** Блокировка — показывать только модераторам (см. ProfilesController). */
      ban: creator.bannedAt
        ? {
            at: creator.bannedAt,
            reason: creator.banReason,
            final: creator.banFinal,
          }
        : null,
      /** Ссылки на соцсети — контакты: только самому креатору и модератору. */
      links: full ? creator.socialLinks : [],
      /** Кошелёк для выплат — только самому креатору и модератору. */
      wallet: full ? creator.payoutWallet : null,
      /** Сообщения о новых заказах — переключатель в своём профиле. */
      notifyNewOrders: full ? creator.notifyNewOrders : null,
      reviews: reviews.map((s) => ({
        submissionId: s.id,
        rating: s.rating!,
        review: s.review,
        orderTitle: titleOf(s.order),
        decidedAt: s.decidedAt,
      })),
      // ссылка на видео обычно ведёт на аккаунт креатора — рекламодателю только название работы
      portfolio: portfolio.map((s) => ({
        submissionId: s.id,
        videoUrl: full ? s.videoUrl : null,
        orderTitle: titleOf(s.order),
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

  updateLinks(userId: number, links: string[]) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { socialLinks: links },
    });
  }

  updateLanguage(userId: number, language: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { language },
    });
  }

  updateCabinet(userId: number, cabinet: Cabinet) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { cabinet },
    });
  }

  updateNotifications(userId: number, notifyNewOrders: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notifyNewOrders },
    });
  }

  /** `replaced` — был другой кошелёк: смена, а не первый ввод (User.walletChangedAt). */
  updateWallet(userId: number, payoutWallet: string | null, replaced: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { payoutWallet, ...(replaced && { walletChangedAt: new Date() }) },
    });
  }
}
