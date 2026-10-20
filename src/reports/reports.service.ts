import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ReportStatus,
  ReportTarget,
  SubmissionStatus,
  type User,
} from '@prisma/client';
import { creatorLabel } from '../common/format';
import {
  isDbId,
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
} from '../common/validation';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';

/** Коды причин по типу объекта; подписи — во фронте (webapp/src/api.ts, REPORT_REASONS). */
export const REPORT_REASONS: Record<ReportTarget, string[]> = {
  // OFF_PLATFORM — предлагает связь или оплату в обход площадки
  ORDER: [
    'FRAUD',
    'PROHIBITED',
    'FAKE_REVIEWS',
    'PERSONAL_DATA',
    'SPAM',
    'OFF_PLATFORM',
    'OTHER',
  ],
  VIDEO: [
    'STOLEN',
    'UNAVAILABLE',
    'BRAND_NEGATIVE',
    'BLACKMAIL',
    'OFF_PLATFORM',
    'OTHER',
  ],
  REVIEW: ['INSULT', 'FALSE', 'PERSONAL_DATA', 'OFF_PLATFORM', 'OTHER'],
  PROFILE: ['IMPERSONATION', 'OFFENSIVE', 'OFF_PLATFORM', 'OTHER'],
};

/** Видео, которые уже дошли до рекламодателя. */
const SEEN_BY_ADVERTISER: SubmissionStatus[] = [
  SubmissionStatus.MODERATOR_APPROVED,
];

type Group = { target: ReportTarget; targetId: number };

/**
 * Жалобы: пожаловаться можно только на то, что человек реально видел. Модератор решает все
 * жалобы на один объект разом: «нарушений нет» или мера, своя для каждого типа объекта.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly profiles: ProfilesService,
  ) {}

  /** Тело `POST /api/reports` → проверенная жалоба. */
  parse(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const target = b.target as ReportTarget;
    if (!Object.values(ReportTarget).includes(target))
      throw new BadRequestException(tr('errors.reportUnknown'));
    const targetId = b.targetId;
    if (!isDbId(targetId))
      throw new BadRequestException(tr('errors.reportUnknown'));
    const reason = b.reason as string;
    if (!REPORT_REASONS[target].includes(reason))
      throw new BadRequestException(tr('errors.reportReason'));
    const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
    if (comment.length > MAX_COMMENT_LENGTH)
      throw new BadRequestException(
        tr('errors.commentTooLong', { max: MAX_COMMENT_LENGTH }),
      );
    const meaningful = isMeaningfulText(comment);
    if (reason === 'OTHER' && !meaningful)
      throw new BadRequestException(tr('errors.describeProblem'));
    return {
      target,
      targetId,
      reason,
      comment: meaningful ? comment : null,
    };
  }

  /** Создаёт жалобу; возвращает короткое описание объекта — для уведомления модераторам. */
  async create(
    reporter: User,
    report: ReturnType<ReportsService['parse']>,
  ): Promise<string> {
    const what = await this.describeIfVisible(
      reporter,
      report.target,
      report.targetId,
    );
    if (!what) throw new NotFoundException(tr('errors.notFound'));
    try {
      await this.prisma.report.create({
        data: { reporterId: reporter.id, ...report },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(tr('errors.alreadyReported'));
      throw err;
    }
    return what;
  }

  /** Описание объекта, если reporter может на него пожаловаться; иначе null. */
  private async describeIfVisible(
    reporter: User,
    target: ReportTarget,
    id: number,
  ): Promise<string | null> {
    switch (target) {
      case ReportTarget.ORDER: {
        const order = await this.prisma.order.findUnique({ where: { id } });
        const visible =
          order &&
          order.advertiserId !== reporter.id &&
          order.status !== OrderStatus.PENDING_MODERATION &&
          order.status !== OrderStatus.REJECTED;
        return visible ? `заказ «${order.title}»` : null;
      }
      case ReportTarget.VIDEO: {
        const s = await this.prisma.submission.findUnique({
          where: { id },
          include: { order: true },
        });
        const visible =
          s &&
          s.order.advertiserId === reporter.id &&
          SEEN_BY_ADVERTISER.includes(s.status);
        return visible ? `видео по заказу «${s.order.title}»` : null;
      }
      case ReportTarget.REVIEW: {
        const s = await this.prisma.submission.findUnique({
          where: { id },
          include: { order: true },
        });
        // отзыв на проверке креатор ещё не видел
        const visible =
          s &&
          s.creatorId === reporter.id &&
          s.rating !== null &&
          s.reviewQueuedAt === null;
        return visible ? `отзыв по заказу «${s.order.title}»` : null;
      }
      case ReportTarget.PROFILE: {
        const visible =
          id !== reporter.id &&
          (await this.profiles.canView(reporter, id, false));
        if (!visible) return null;
        const user = await this.prisma.user.findUnique({ where: { id } });
        return user ? `профиль ${creatorLabel(user)}` : null;
      }
    }
  }

  /** Открытые жалобы, сгруппированные по объекту; старые группы первыми. */
  async listOpen() {
    const reports = await this.prisma.report.findMany({
      where: { status: ReportStatus.OPEN },
      orderBy: { createdAt: 'asc' },
      include: { reporter: true },
    });
    const groups = new Map<string, Group & { reports: typeof reports }>();
    for (const r of reports) {
      const key = `${r.target}:${r.targetId}`;
      const group = groups.get(key) ?? {
        target: r.target,
        targetId: r.targetId,
        reports: [],
      };
      group.reports.push(r);
      groups.set(key, group);
    }
    return Promise.all(
      [...groups.values()].map(async (g) => ({
        target: g.target,
        targetId: g.targetId,
        subject: await this.subject(g),
        reports: g.reports.map((r) => ({
          id: r.id,
          reason: r.reason,
          comment: r.comment,
          reporter: creatorLabel(r.reporter),
          createdAt: r.createdAt,
        })),
      })),
    );
  }

  /**
   * Что показать модератору об объекте жалобы; `null` — объект уже удалён.
   * `authorId` — кто отвечает за объект (его и блокировать), `profileId` — какой профиль открыть,
   * `orderId` — какой заказ открыть.
   */
  private async subject({ target, targetId }: Group) {
    if (target === ReportTarget.ORDER) {
      const o = await this.orders.findWithAdvertiser(targetId);
      return (
        o && {
          title: o.title,
          text: o.description,
          author: creatorLabel(o.advertiser),
          authorId: o.advertiserId,
          profileId: null,
          orderId: o.id,
        }
      );
    }
    if (target === ReportTarget.PROFILE) {
      const u = await this.prisma.user.findUnique({ where: { id: targetId } });
      return (
        u && {
          title: creatorLabel(u),
          text: null,
          author: creatorLabel(u),
          authorId: u.id,
          profileId: u.id,
          orderId: null,
        }
      );
    }
    // VIDEO и REVIEW — отклик; отзыв виден в профиле креатора, но написал его рекламодатель
    const s = await this.prisma.submission.findUnique({
      where: { id: targetId },
      include: { creator: true, order: { include: { advertiser: true } } },
    });
    if (!s) return null;
    const review = target === ReportTarget.REVIEW;
    return {
      title: s.order.title,
      text: review
        ? `${'★'.repeat(s.rating ?? 0)} ${s.review ?? ''}`.trim()
        : s.videoUrl,
      author: creatorLabel(review ? s.order.advertiser : s.creator),
      authorId: review ? s.order.advertiserId : s.creatorId,
      profileId: s.creatorId,
      orderId: s.orderId,
    };
  }

  /** Кто отвечает за объект жалобы (его блокируют); `null` — объект удалён. */
  async authorOf(group: Group) {
    return (await this.subject(group))?.authorId ?? null;
  }

  /**
   * Решение по всем открытым жалобам на объект. `actioned` — применить меру для этого типа:
   * заказ — снять (OrdersService.moderatorClose), видео — убрать из портфолио, отзыв — удалить,
   * профиль — стереть ссылки. Жалобы помечаются первыми — второй модератор получит отказ и меру не
   * применит повторно; всё в одной транзакции: мера не прошла — жалобы остаются открытыми.
   */
  resolve(group: Group, actioned: boolean, moderatorTelegramId: bigint) {
    return this.prisma.$transaction((tx) =>
      this.resolveIn(tx, group, actioned, moderatorTelegramId),
    );
  }

  private async resolveIn(
    tx: Prisma.TransactionClient,
    group: Group,
    actioned: boolean,
    moderatorTelegramId: bigint,
  ) {
    const reports = await tx.report.findMany({
      where: { ...group, status: ReportStatus.OPEN },
      include: { reporter: true },
    });
    const { count } = await tx.report.updateMany({
      where: {
        id: { in: reports.map((r) => r.id) },
        status: ReportStatus.OPEN,
      },
      data: {
        status: actioned ? ReportStatus.ACTIONED : ReportStatus.DISMISSED,
        moderatorId: moderatorTelegramId,
        decidedAt: new Date(),
      },
    });
    if (count === 0) throw new ForbiddenException('Эти жалобы уже рассмотрены');

    let closedOrder: Awaited<ReturnType<OrdersService['moderatorClose']>> =
      null;
    if (actioned) {
      switch (group.target) {
        case ReportTarget.ORDER:
          closedOrder = await this.orders.moderatorClose(tx, group.targetId);
          break;
        case ReportTarget.VIDEO:
          await tx.submission.updateMany({
            where: { id: group.targetId },
            data: { portfolioAllowed: false },
          });
          break;
        case ReportTarget.REVIEW:
          await tx.submission.updateMany({
            where: { id: group.targetId },
            data: { rating: null, review: null, reviewQueuedAt: null },
          });
          break;
        case ReportTarget.PROFILE:
          await tx.user.updateMany({
            where: { id: group.targetId },
            data: { socialLinks: [] },
          });
          break;
      }
    }
    return {
      reporters: reports.map((r) => r.reporter.telegramId),
      closedOrder,
    };
  }
}
