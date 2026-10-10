import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, ReportTarget } from '@prisma/client';
import { ModeratorGuard } from '../auth/moderator.guard';
import {
  isDbId,
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
} from '../common/validation';
import { ReportsService } from '../reports/reports.service';
import { closeOpenOrders, rejectPendingOrders } from '../orders/order-status';
import { PrismaService } from '../prisma/prisma.service';
import {
  deleteInProgress,
  expireSlots,
  rejectSubmitted,
} from '../submissions/submission-status';

/** Причина блокировки — её увидит заблокированный. */
export function parseBanReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!isMeaningfulText(reason))
    throw new BadRequestException('Укажите причину блокировки');
  if (reason.length > MAX_COMMENT_LENGTH)
    throw new BadRequestException(
      `Причина длиннее ${MAX_COMMENT_LENGTH} символов`,
    );
  return reason;
}

/**
 * Тело `POST /api/mod/reports/resolve`: на какой объект жалобы, применить ли меру и, по желанию,
 * причина бана автора объекта (тогда мера применяется в любом случае).
 */
export function parseReportDecision(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const target = b.target as ReportTarget;
  if (
    !Object.values(ReportTarget).includes(target) ||
    !isDbId(b.targetId) ||
    typeof b.actioned !== 'boolean'
  )
    throw new BadRequestException('Некорректное решение');
  const banReason =
    b.banReason === undefined ? null : parseBanReason(b.banReason);
  return {
    group: { target, targetId: b.targetId },
    actioned: b.actioned || banReason !== null,
    banReason,
  };
}

const BANNED_COMMENT = 'Автор заблокирован за нарушение правил площадки';

/**
 * Блокировка пользователя. Всё в одной транзакции: пользователь заблокирован, его открытые заказы
 * закрыты, заказы на модерации отклонены, отклики без видео удалены, видео у модератора отклонены.
 * Принятые видео, отзывы и видео, ждущие решения рекламодателя, остаются — это чужая история работы.
 */
@Injectable()
export class BansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly moderatorGuard: ModeratorGuard,
  ) {}

  /** Бан модератором вручную. Возвращает снятые заказы с креаторами — им уведомление. */
  async banUser(userId: number, reason: string) {
    await this.mustNotBeModerator(userId);
    return this.ban(userId, reason);
  }

  /**
   * Решение по всем жалобам на объект и, если указана причина, бан его автора. Уже заблокированного
   * не блокируем повторно (и другой модератор мог успеть) — мера по жалобам применяется всё равно.
   * Возвращает, кого уведомить: жалобщиков, заказ, закрытый по мере, и заказы забаненного.
   */
  async resolveReports(
    decision: ReturnType<typeof parseReportDecision>,
    moderatorTelegramId: bigint,
  ) {
    const { group, actioned, banReason } = decision;
    const authorId = banReason ? await this.reports.authorOf(group) : null;
    if (banReason && !authorId)
      throw new BadRequestException('Объект удалён — автора не найти');
    const toBan =
      authorId && !(await this.mustNotBeModerator(authorId)).bannedAt
        ? authorId
        : null;
    const { reporters, closedOrder } = await this.reports.resolve(
      group,
      actioned,
      moderatorTelegramId,
    );
    let bannedOrders: Awaited<ReturnType<BansService['ban']>> = [];
    if (toBan)
      try {
        bannedOrders = await this.ban(toBan, banReason!);
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
      }
    return { reporters, closedOrder, bannedOrders };
  }

  /** Модераторы задаются в env — их не блокируют. Возвращает пользователя. */
  private async mustNotBeModerator(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (this.moderatorGuard.isModerator(user))
      throw new ForbiddenException('Модератора заблокировать нельзя');
    return user;
  }

  /** Возвращает закрытые и отклонённые заказы с креаторами — им уведомление. */
  async ban(userId: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, bannedAt: null },
        data: { bannedAt: new Date(), banReason: reason },
      });
      if (count === 0) {
        const exists = await tx.user.findUnique({ where: { id: userId } });
        if (!exists) throw new NotFoundException('Пользователь не найден');
        throw new ForbiddenException('Пользователь уже заблокирован');
      }

      const open = await tx.order.findMany({
        where: { advertiserId: userId, status: OrderStatus.OPEN },
        select: { id: true },
      });
      // на проверке может быть и изменённый открытый заказ — у него есть креаторы в работе
      const pending = await tx.order.findMany({
        where: { advertiserId: userId, status: OrderStatus.PENDING_MODERATION },
        select: { id: true },
      });
      const openIds = open.map((o) => o.id);
      const pendingIds = pending.map((o) => o.id);
      await closeOpenOrders(tx, openIds);
      await rejectPendingOrders(tx, pendingIds, BANNED_COMMENT);
      // по закрытым заказам автора чужие ролики больше не сдают
      await expireSlots(tx, openIds);
      // Заказы на повторной проверке сняты — чужие ролики по ним не ждут модератора, как в
      // OrdersService.moderatorReject; резерв возвращается в фонд.
      await rejectSubmitted(
        tx,
        { orderId: { in: pendingIds } },
        'Заказ снят модератором',
      );
      // работа самого заблокированного: без видео — удаляем, на проверке — отклоняем
      await deleteInProgress(tx, userId);
      await rejectSubmitted(tx, { creatorId: userId }, BANNED_COMMENT);
      return tx.order.findMany({
        where: { id: { in: [...open, ...pending].map((o) => o.id) } },
        include: {
          advertiser: true,
          submissions: { include: { creator: true } },
        },
      });
    });
  }

  async unban(userId: number) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, bannedAt: { not: null } },
      data: { bannedAt: null, banReason: null },
    });
    if (count === 0)
      throw new NotFoundException('Пользователь не заблокирован');
  }
}
