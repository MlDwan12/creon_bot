import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupportService } from '../support/support.service';
import { creatorLabel, escapeHtml, formatMoney } from '../common/format';
import { fromMinor } from '../common/money';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import {
  MIN_PAYOUT,
  parsePayoutAmount,
  PayoutsService,
} from './payouts.service';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';

/** Баланс креатора и заявки на вывод. Суммы наружу — в USDT. */
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
      earned: fromMinor(balance.earnedMinor),
      paid: fromMinor(balance.paidMinor),
      requested: fromMinor(balance.requestedMinor),
      available: fromMinor(balance.availableMinor),
      minPayout: MIN_PAYOUT,
      /** Кошелёк из профиля: без него вывести нельзя. */
      wallet: req.user.payoutWallet,
      payouts: history.map((p) => ({
        id: p.id,
        amount: fromMinor(p.amountMinor),
        status: p.status,
        comment: p.comment,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt,
      })),
    };
  }

  /** Заявка на вывод `amount` USDT на кошелёк из профиля; менеджеру — сообщение в поддержку. */
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
        `Сумма: ${formatMoney(fromMinor(payout.amountMinor))}`,
        `Кошелёк USDT (TRC20): <code>${escapeHtml(payout.wallet ?? '')}</code>`,
        'После перевода отметьте заявку в мини-аппе: Модерация → Выплаты.',
      ].join('\n'),
    );
    return { ok: true };
  }
}
