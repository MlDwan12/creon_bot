import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayoutStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { rublesToKopecks } from '../common/money';
import { ORDER_CURRENCY } from '../orders/budget';
import { PrismaService } from '../prisma/prisma.service';

/** Минимальная сумма вывода, ₽: мелкие переводы вручную не окупают работу менеджера. */
export const MIN_PAYOUT = 100;

/** Заявки, которые уже списаны с баланса: ждут перевода или переведены. */
const HOLDS_BALANCE: PayoutStatus[] = [
  PayoutStatus.REQUESTED,
  PayoutStatus.PAID,
];

/** Сумма вывода — целые рубли, от MIN_PAYOUT. Не больше баланса проверяет requestPayout. */
export function parsePayoutAmount(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < MIN_PAYOUT)
    throw new BadRequestException(
      `Сумма вывода — целое число рублей от ${MIN_PAYOUT}`,
    );
  return rublesToKopecks(value as number);
}

/**
 * Баланс креатора и заявки на вывод. Начисления — `payoutMinor` одобренных роликов (их считает
 * SubmissionsService), выплаты — вручную менеджером по заявкам.
 */
@Injectable()
export class PayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Начислено, выплачено, в заявке и доступно к выводу — всё в копейках. */
  async balance(creatorId: number, db: Prisma.TransactionClient = this.prisma) {
    const [earned, payouts] = await Promise.all([
      db.submission.aggregate({
        where: { creatorId, status: SubmissionStatus.MODERATOR_APPROVED },
        _sum: { payoutMinor: true },
      }),
      db.payout.groupBy({
        by: ['status'],
        where: { creatorId, status: { in: HOLDS_BALANCE } },
        _sum: { amountMinor: true },
      }),
    ]);
    const sum = (status: PayoutStatus) =>
      payouts.find((p) => p.status === status)?._sum.amountMinor ?? 0;
    const earnedMinor = earned._sum.payoutMinor ?? 0;
    const paidMinor = sum(PayoutStatus.PAID);
    const requestedMinor = sum(PayoutStatus.REQUESTED);
    return {
      earnedMinor,
      paidMinor,
      requestedMinor,
      availableMinor: earnedMinor - paidMinor - requestedMinor,
    };
  }

  listByCreator(creatorId: number) {
    return this.prisma.payout.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Заявка на вывод. Одна открытая заявка на креатора (частичный уникальный индекс), а проверка
   * баланса и запись — под блокировкой строки пользователя: двойной тап не выведет больше баланса.
   */
  async requestPayout(creatorId: number, amountMinor: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${creatorId} FOR UPDATE`;
        const { availableMinor } = await this.balance(creatorId, tx);
        if (amountMinor > availableMinor)
          throw new ForbiddenException('Сумма больше доступного баланса');
        return tx.payout.create({
          data: { creatorId, amountMinor, currency: ORDER_CURRENCY },
          include: { creator: true },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(
          'У вас уже есть заявка на вывод — дождитесь, пока менеджер её обработает',
        );
      throw err;
    }
  }

  /** Очередь менеджера: открытые заявки, старые первыми. */
  listRequested() {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.REQUESTED },
      orderBy: { createdAt: 'asc' },
      include: { creator: true },
    });
  }

  /** Деньги переведены. */
  markPaid(payoutId: number, moderatorTelegramId: bigint) {
    return this.transitionStatus(payoutId, {
      status: PayoutStatus.PAID,
      moderatorId: moderatorTelegramId,
      decidedAt: new Date(),
    });
  }

  /** Отказ с причиной — сумма возвращается на баланс. */
  reject(payoutId: number, moderatorTelegramId: bigint, comment: string) {
    return this.transitionStatus(payoutId, {
      status: PayoutStatus.REJECTED,
      moderatorId: moderatorTelegramId,
      comment,
      decidedAt: new Date(),
    });
  }

  /** Решение только по открытой заявке — два модератора не обработают её дважды. */
  private async transitionStatus(
    payoutId: number,
    data: Prisma.PayoutUpdateManyMutationInput,
  ) {
    const { count } = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: PayoutStatus.REQUESTED },
      data,
    });
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { creator: true },
    });
    if (!payout) throw new NotFoundException('Заявка не найдена');
    if (count === 0) throw new ForbiddenException('Эта заявка уже обработана');
    return payout;
  }
}
