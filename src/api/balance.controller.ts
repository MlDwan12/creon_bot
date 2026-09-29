import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupportService } from '../bot/support.service';
import { creatorLabel, escapeHtml, formatRubles } from '../bot/utils/format';
import { kopecksToRubles } from '../common/money';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import {
  MIN_PAYOUT,
  parsePayoutAmount,
  PayoutsService,
} from './payouts.service';
import { UserThrottlerGuard } from './user-throttler.guard';

/** Баланс креатора и заявки на вывод. Суммы наружу — в рублях. */
@Controller('api/balance')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class BalanceController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly support: SupportService,
  ) {}

  @Get()
  async get(@Req() req: ApiRequest) {
    const [balance, history] = await Promise.all([
      this.payouts.balance(req.user.id),
      this.payouts.listByCreator(req.user.id),
    ]);
    return {
      earned: kopecksToRubles(balance.earnedMinor),
      paid: kopecksToRubles(balance.paidMinor),
      requested: kopecksToRubles(balance.requestedMinor),
      available: kopecksToRubles(balance.availableMinor),
      minPayout: MIN_PAYOUT,
      payouts: history.map((p) => ({
        id: p.id,
        amount: kopecksToRubles(p.amountMinor),
        status: p.status,
        comment: p.comment,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt,
      })),
    };
  }

  /** Заявка на вывод `amount` ₽; менеджеру — сообщение в поддержку, реквизиты он спросит в теме креатора. */
  @Post('withdraw')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async withdraw(@Body('amount') amount: unknown, @Req() req: ApiRequest) {
    const payout = await this.payouts.requestPayout(
      req.user.id,
      parsePayoutAmount(amount),
    );
    await this.support.paymentDue(
      [
        `💸 <b>Заявка на вывод #${payout.id}</b>`,
        `Креатор: ${escapeHtml(creatorLabel(payout.creator))} (#u${payout.creator.telegramId})`,
        `Сумма: ${formatRubles(kopecksToRubles(payout.amountMinor))}`,
        'Реквизиты — в теме креатора. После перевода отметьте заявку в мини-аппе: Модерация → Выплаты.',
      ].join('\n'),
    );
    return { ok: true };
  }
}
