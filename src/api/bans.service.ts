import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, SubmissionStatus } from '@prisma/client';
import { isMeaningfulText, MAX_COMMENT_LENGTH } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

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

const BANNED_COMMENT = 'Автор заблокирован за нарушение правил площадки';

/**
 * Блокировка пользователя. Всё в одной транзакции: пользователь заблокирован, его открытые заказы
 * закрыты, заказы на модерации отклонены, отклики без видео удалены, видео у модератора отклонены.
 * Принятые видео, отзывы и видео, ждущие решения рекламодателя, остаются — это чужая история работы.
 */
@Injectable()
export class BansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Возвращает закрытые заказы с креаторами — им уведомление. */
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
      await tx.order.updateMany({
        where: { id: { in: open.map((o) => o.id) } },
        data: { status: OrderStatus.CLOSED, closedAt: new Date() },
      });
      await tx.order.updateMany({
        where: { advertiserId: userId, status: OrderStatus.PENDING_MODERATION },
        data: {
          status: OrderStatus.REJECTED,
          moderatorComment: BANNED_COMMENT,
          decidedAt: new Date(),
        },
      });
      await tx.submission.deleteMany({
        where: { creatorId: userId, status: SubmissionStatus.IN_PROGRESS },
      });
      await tx.submission.updateMany({
        where: { creatorId: userId, status: SubmissionStatus.SUBMITTED },
        data: {
          status: SubmissionStatus.MODERATOR_REJECTED,
          moderatorComment: BANNED_COMMENT,
          decidedAt: new Date(),
        },
      });

      return tx.order.findMany({
        where: { id: { in: open.map((o) => o.id) } },
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
