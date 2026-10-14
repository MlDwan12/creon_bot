import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayoutStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { toMinor } from '../common/money';
import { ORDER_CURRENCY, VIEWS_TOPUP_DAYS } from '../orders/budget';
import { DAY_MS } from '../orders/deadline';
import { PrismaService } from '../prisma/prisma.service';

/** Минимальная сумма вывода, USDT: перевод в TRC20 стоит комиссии сети, мелкие не окупаются. */
export const MIN_PAYOUT = 10;

/** Заявки, которые уже списаны с баланса: ждут перевода или переведены. */
const HOLDS_BALANCE: PayoutStatus[] = [
  PayoutStatus.REQUESTED,
  PayoutStatus.PAID,
];

/** Сумма вывода — целые USDT, от MIN_PAYOUT. Не больше баланса проверяет requestPayout. */
export function parsePayoutAmount(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < MIN_PAYOUT)
    throw new BadRequestException(
      tr('errors.payoutAmount', { min: MIN_PAYOUT }),
    );
  return toMinor(value as number);
}

/**
 * Баланс креатора и заявки на вывод. Начисления — `payoutMinor` одобренных роликов (их считает
 * SubmissionsService), выплаты — вручную менеджером по заявкам.
 */
@Injectable()
export class PayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Начислено, в холде, выплачено, в заявке и доступно к выводу — всё в центах. В холде — ролики,
   * по которым ещё не зафиксирован итог (VIEWS_TOPUP_DAYS после одобрения); `nextReleaseAt` — когда
   * подойдёт срок итога у самого раннего из них.
   */
  async balance(creatorId: number, db: Prisma.TransactionClient = this.prisma) {
    const approved = { creatorId, status: SubmissionStatus.MODERATOR_APPROVED };
    const [earned, held, payouts] = await Promise.all([
      db.submission.aggregate({
        where: approved,
        _sum: { payoutMinor: true },
      }),
      db.submission.aggregate({
        where: { ...approved, finalizedAt: null },
        _sum: { payoutMinor: true },
        _min: { decidedAt: true },
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
    const heldMinor = held._sum.payoutMinor ?? 0;
    const paidMinor = sum(PayoutStatus.PAID);
    const requestedMinor = sum(PayoutStatus.REQUESTED);
    const firstHeld = held._min.decidedAt;
    return {
      earnedMinor,
      heldMinor,
      paidMinor,
      requestedMinor,
      // до холда выводили и неподтверждённое — тогда выведено больше освобождённого, а не минус
      availableMinor: Math.max(
        0,
        earnedMinor - heldMinor - paidMinor - requestedMinor,
      ),
      nextReleaseAt: firstHeld
        ? new Date(firstHeld.getTime() + VIEWS_TOPUP_DAYS * DAY_MS)
        : null,
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
   * Кошелёк из профиля копируется в заявку.
   */
  async requestPayout(creatorId: number, amountMinor: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [user] = await tx.$queryRaw<{ payoutWallet: string | null }[]>`
          SELECT "payoutWallet" FROM "User" WHERE id = ${creatorId} FOR UPDATE`;
        if (!user?.payoutWallet)
          throw new BadRequestException(tr('errors.payoutNeedWallet'));
        const { availableMinor } = await this.balance(creatorId, tx);
        if (amountMinor > availableMinor)
          throw new ForbiddenException(tr('errors.payoutTooMuch'));
        return tx.payout.create({
          data: {
            creatorId,
            amountMinor,
            currency: ORDER_CURRENCY,
            wallet: user.payoutWallet,
          },
          include: { creator: true },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(tr('errors.payoutPending'));
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

  /** Сколько заявок ждёт перевода с момента раньше `before` — для напоминания. */
  countRequestedBefore(before: Date) {
    return this.prisma.payout.count({
      where: { status: PayoutStatus.REQUESTED, createdAt: { lt: before } },
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
