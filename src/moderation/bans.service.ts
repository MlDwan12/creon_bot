import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, ReportTarget, SubmissionStatus } from '@prisma/client';
import { ModeratorGuard } from '../auth/moderator.guard';
import {
  isDbId,
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
} from '../common/validation';
import { ReportsService } from '../reports/reports.service';
import {
  closeOpenOrders,
  freedOrder,
  FROZEN,
  lockOrder,
  rejectPendingOrders,
} from '../orders/order-status';
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

  /**
   * Бан модератором вручную; `final` — без права обжалования. Возвращает снятые заказы и заказы,
   * где освободился фонд, — с креаторами для уведомлений.
   */
  async banUser(userId: number, reason: string, final: boolean) {
    const user = await this.mustNotBeModerator(userId);
    // ужесточение обычного бана: заказы и отклики уже сняты первым баном
    if (user.bannedAt && final) {
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, bannedAt: { not: null }, banFinal: false },
        data: { banFinal: true, banReason: reason },
      });
      if (count === 0)
        throw new ForbiddenException('Пользователь уже заблокирован');
      return { closed: [], freed: [] };
    }
    return this.ban(userId, reason, final);
  }

  /**
   * Решение по всем жалобам на объект и, если указана причина, бан его автора. Уже заблокированного
   * не блокируем повторно (и другой модератор мог успеть) — мера по жалобам применяется всё равно.
   * Возвращает, кого уведомить: жалобщиков, заказ, закрытый по мере, и заказы забаненного, — и кого забанили.
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
    let bannedOrders: Awaited<ReturnType<BansService['ban']>> = {
      closed: [],
      freed: [],
    };
    /** Кого заблокировали этим решением; null — бана не было (или другой модератор успел раньше). */
    let bannedUserId: number | null = null;
    if (toBan)
      try {
        bannedOrders = await this.ban(toBan, banReason!);
        bannedUserId = toBan;
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
      }
    return { reporters, closedOrder, bannedOrders, bannedUserId };
  }

  /** Модераторы задаются в env — их не блокируют. Возвращает пользователя. */
  private async mustNotBeModerator(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (this.moderatorGuard.isModerator(user))
      throw new ForbiddenException('Модератора заблокировать нельзя');
    return user;
  }

  /**
   * Возвращает `closed` — закрытые и отклонённые заказы автора и `freed` — чужие заказы, где
   * отклонённые ролики заблокированного освободили «занятый» фонд; у обоих — креаторы для уведомлений.
   */
  async ban(userId: number, reason: string, final = false) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, bannedAt: null },
        data: { bannedAt: new Date(), banReason: reason, banFinal: final },
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
      // на проверке или с отклонённой правкой — замороженный опубликованный, у него есть креаторы в работе
      const pending = await tx.order.findMany({
        where: { advertiserId: userId, status: { in: FROZEN } },
        select: { id: true },
      });
      const openIds = open.map((o) => o.id);
      const pendingIds = pending.map((o) => o.id);
      await closeOpenOrders(tx, openIds);
      await rejectPendingOrders(tx, pendingIds, BANNED_COMMENT);
      // по закрытым и снятым заказам автора чужие ролики больше не сдают
      await expireSlots(tx, [...openIds, ...pendingIds]);
      // Заказы на повторной проверке сняты — чужие ролики по ним не ждут модератора, как в
      // OrdersService.moderatorReject; резерв возвращается в фонд.
      await rejectSubmitted(
        tx,
        { orderId: { in: pendingIds } },
        'Заказ снят модератором',
      );
      // работа самого заблокированного: без видео — удаляем, на проверке — отклоняем. Резерв
      // возвращается в фонды чужих заказов — под их блокировкой (по возрастанию id, без взаимных
      // ожиданий), и «весь фонд зарезервирован» пересчитывается сразу.
      await deleteInProgress(tx, userId);
      const reserved = await tx.submission.findMany({
        where: { creatorId: userId, status: SubmissionStatus.SUBMITTED },
        select: { orderId: true },
        distinct: ['orderId'],
        orderBy: { orderId: 'asc' },
      });
      for (const { orderId } of reserved) await lockOrder(tx, orderId);
      await rejectSubmitted(tx, { creatorId: userId }, BANNED_COMMENT);
      const freed: NonNullable<Awaited<ReturnType<typeof freedOrder>>>[] = [];
      for (const { orderId } of reserved) {
        const order = await freedOrder(tx, orderId);
        if (order) freed.push(order);
      }
      const closed = await tx.order.findMany({
        where: { id: { in: [...open, ...pending].map((o) => o.id) } },
        include: {
          advertiser: true,
          submissions: { include: { creator: true } },
        },
      });
      return { closed, freed };
    });
  }

  async unban(userId: number) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, bannedAt: { not: null } },
      data: { bannedAt: null, banReason: null, banFinal: false },
    });
    if (count === 0)
      throw new NotFoundException('Пользователь не заблокирован');
  }
}
