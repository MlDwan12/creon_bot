import { ConfigService } from '@nestjs/config';
import { Action, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../orders/orders.service';
import { SubmissionsService } from '../../submissions/submissions.service';
import type { BotContext } from '../interfaces/bot-context.interface';
import {
  MODERATOR_MENU_BUTTONS,
  USER_MENU_BUTTONS,
} from '../keyboards/menu.keyboard';
import { MODERATOR_REJECT_SCENE_ID } from '../scenes/moderator-reject.scene';
import { ORDER_REJECT_SCENE_ID } from '../scenes/order-reject.scene';
import { styled } from '../utils/button.util';
import { errorMessage } from '../utils/error.util';
import {
  escapeHtml,
  formatOrderCard,
  formatSubmissionCard,
  html,
  submissionForAdvertiserLabel,
} from '../utils/format';
import { isModerator, parseModeratorIds } from '../utils/moderator.util';
import {
  closeMessage,
  getMatch,
  navRow,
  PAGE_SIZE,
  replyOrEdit,
} from '../utils/ui.util';

/**
 * Всё меню модератора: очередь заказов, очередь видео, все заказы, статистика.
 * Каждый обработчик начинается с `if (await this.denied(ctx)) return;`.
 */
@Update()
export class ModerationUpdate {
  private readonly moderatorIds: Set<string>;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    config: ConfigService,
  ) {
    this.moderatorIds = parseModeratorIds(config.get<string>('MODERATOR_IDS'));
  }

  /** true — не модератор. На нажатие inline-кнопки отвечает «Недостаточно прав», текст меню молча игнорирует. */
  private async denied(ctx: BotContext): Promise<boolean> {
    if (isModerator(ctx.from!.id, this.moderatorIds)) return false;
    if (ctx.callbackQuery) await ctx.answerCbQuery('Недостаточно прав');
    return true;
  }

  @Hears(MODERATOR_MENU_BUTTONS.ORDER_QUEUE)
  async onOrderQueue(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    await this.sendPendingOrderCard(ctx, 0);
  }

  @Action(/^modq:nav:(\d+)$/)
  async onModQueueNav(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const index = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await this.sendPendingOrderCard(ctx, index, true);
  }

  @Action('modq:close')
  async onModQueueClose(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    await closeMessage(ctx, 'Очередь закрыта.');
  }

  /** Moderator's "orders awaiting review" carousel — one pending order at a time. */
  private async sendPendingOrderCard(
    ctx: BotContext,
    index: number,
    edit = false,
  ) {
    const { order, total } = await this.ordersService.getPendingAt(index);
    if (!order) {
      await replyOrEdit(ctx, 'Заказов на проверку нет.', undefined, edit);
      return;
    }
    const text = `${formatOrderCard(order, undefined, true)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push(navRow(index, total, (i) => `modq:nav:${i}`));
    }
    rows.push([
      styled(
        Markup.button.callback('✅ Одобрить', `order:approve:${order.id}`),
        'success',
      ),
      styled(
        Markup.button.callback('❌ Отклонить', `order:reject:${order.id}`),
        'danger',
      ),
    ]);
    rows.push([
      styled(Markup.button.callback('✖️ Закрыть', 'modq:close'), 'danger'),
    ]);
    await replyOrEdit(ctx, text, html(Markup.inlineKeyboard(rows)), edit);
  }

  @Action(/^order:approve:(\d+)$/)
  async onOrderApprove(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const id = Number(getMatch(ctx)[1]);
    let order: Awaited<ReturnType<typeof this.ordersService.moderatorApprove>>;
    try {
      order = await this.ordersService.moderatorApprove(
        id,
        BigInt(ctx.from!.id),
      );
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err));
      return;
    }
    await ctx.answerCbQuery('Заказ опубликован');
    await ctx.editMessageText(`✅ Заказ #${order.id} одобрен и опубликован.`);
    try {
      await ctx.telegram.sendMessage(
        order.advertiser.telegramId.toString(),
        `✅ Ваш заказ «${order.title}» прошёл модерацию и опубликован — креаторы уже видят его в «${USER_MENU_BUTTONS.BROWSE_ORDERS}».`,
      );
    } catch {
      // рекламодатель мог заблокировать бота
    }
  }

  @Action(/^order:reject:(\d+)$/)
  async onOrderReject(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const id = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(ORDER_REJECT_SCENE_ID, { orderId: id });
  }

  @Hears(MODERATOR_MENU_BUTTONS.ALL_ORDERS)
  async onAllOrders(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    await this.sendAllOrderCard(ctx, 0);
  }

  @Action(/^all-orders:nav:(\d+)$/)
  async onAllOrdersNav(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const index = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await this.sendAllOrderCard(ctx, index, true);
  }

  @Action('all-orders:close')
  async onAllOrdersClose(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    await closeMessage(ctx);
  }

  /** Moderator's full oversight carousel — every order regardless of status, one at a time. */
  private async sendAllOrderCard(ctx: BotContext, index: number, edit = false) {
    const { order, total } = await this.ordersService.getAllAt(index);
    if (!order) {
      await replyOrEdit(ctx, 'Заказов пока нет.', undefined, edit);
      return;
    }
    const text = `${formatOrderCard(order, order.submissions, true)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push(navRow(index, total, (i) => `all-orders:nav:${i}`));
    }
    if (order.submissions.length > 0) {
      rows.push([
        styled(
          Markup.button.callback(
            `📥 Отклики (${order.submissions.length})`,
            `allorders:subs:${order.id}:${index}`,
          ),
          'primary',
        ),
      ]);
    }
    rows.push([
      styled(
        Markup.button.callback('✖️ Закрыть', 'all-orders:close'),
        'danger',
      ),
    ]);
    await replyOrEdit(ctx, text, html(Markup.inlineKeyboard(rows)), edit);
  }

  /** Read-only responses list for one order, reachable from the "all orders" oversight carousel. */
  @Action(/^allorders:subs:(\d+):(\d+)$/)
  async onAllOrdersSubmissions(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const match = getMatch(ctx);
    await ctx.answerCbQuery();
    await this.renderAllOrderSubmissions(
      ctx,
      Number(match[1]),
      Number(match[2]),
      0,
    );
  }

  @Action(/^allorders:subs-page:(\d+):(\d+):(\d+)$/)
  async onAllOrdersSubmissionsPage(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const match = getMatch(ctx);
    await ctx.answerCbQuery();
    await this.renderAllOrderSubmissions(
      ctx,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  private async renderAllOrderSubmissions(
    ctx: BotContext,
    orderId: number,
    orderIndex: number,
    page: number,
  ) {
    const order = await this.ordersService.findById(orderId);
    if (!order) {
      await ctx.answerCbQuery('Заказ не найден', { show_alert: true });
      return;
    }
    const items = await this.submissionsService.listByOrder(orderId);
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageItems = items.slice(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE,
    );
    const text = `📥 <b>Отклики — заказ #${orderId}</b> ${escapeHtml(order.title)}\n\nВсего: ${items.length}`;
    const rows = pageItems.map((s) => [
      Markup.button.callback(
        submissionForAdvertiserLabel(s),
        `allorders:sub:${s.id}:${orderId}:${orderIndex}`,
      ),
    ]);
    if (totalPages > 1) {
      rows.push(
        navRow(
          page,
          totalPages,
          (p) => `allorders:subs-page:${orderId}:${orderIndex}:${p}`,
        ),
      );
    }
    rows.push([
      styled(
        Markup.button.callback('◀️ К заказу', `all-orders:nav:${orderIndex}`),
        'primary',
      ),
    ]);
    await ctx.editMessageText(text, html(Markup.inlineKeyboard(rows)));
  }

  @Action(/^allorders:sub:(\d+):(\d+):(\d+)$/)
  async onAllOrdersSubmissionView(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const match = getMatch(ctx);
    const submissionId = Number(match[1]);
    const orderId = Number(match[2]);
    const orderIndex = Number(match[3]);
    const submission = await this.submissionsService.findById(submissionId);
    if (!submission) {
      await ctx.answerCbQuery('Отклик не найден', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const rows = [
      [
        styled(
          Markup.button.callback(
            '◀️ Назад',
            `allorders:subs:${orderId}:${orderIndex}`,
          ),
          'primary',
        ),
      ],
    ];
    await ctx.editMessageText(
      formatSubmissionCard(submission, true),
      html(Markup.inlineKeyboard(rows)),
    );
  }

  @Hears(MODERATOR_MENU_BUTTONS.SUBMISSION_QUEUE)
  async onSubmissionQueue(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const items = await this.submissionsService.listPendingModeration();
    if (items.length === 0) {
      await ctx.reply('Очередь пуста.');
      return;
    }
    for (const s of items) {
      const text = formatSubmissionCard(s, true);
      const kb = html(
        Markup.inlineKeyboard([
          styled(
            Markup.button.callback('✅ Одобрить', `mod:approve:${s.id}`),
            'success',
          ),
          styled(
            Markup.button.callback('❌ Отклонить', `mod:reject:${s.id}`),
            'danger',
          ),
        ]),
      );
      await ctx.reply(text, kb);
    }
  }

  @Hears(MODERATOR_MENU_BUTTONS.STATS)
  async onStats(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const [orderStats, submissionStats] = await Promise.all([
      this.ordersService.stats(),
      this.submissionsService.stats(),
    ]);
    await ctx.reply(
      [
        '📊 Статистика',
        '',
        'Заказы:',
        `🕓 На проверке: ${orderStats.pending}`,
        `✅ Открыто: ${orderStats.open}`,
        `❌ Отклонено: ${orderStats.rejected}`,
        `🔒 Закрыто: ${orderStats.closed}`,
        `Всего: ${orderStats.total}`,
        '',
        'Отклики:',
        `⏳ На модерации: ${submissionStats.pending}`,
        `✅ Подтверждено: ${submissionStats.approved}`,
        `❌ Отклонено: ${submissionStats.rejected}`,
      ].join('\n'),
    );
  }

  @Action(/^mod:approve:(\d+)$/)
  async onModApprove(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const id = Number(getMatch(ctx)[1]);
    let submission: Awaited<
      ReturnType<typeof this.submissionsService.moderatorApprove>
    >;
    try {
      submission = await this.submissionsService.moderatorApprove(
        id,
        BigInt(ctx.from!.id),
      );
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err));
      return;
    }
    await ctx.answerCbQuery('Одобрено');
    await ctx.editMessageText('✅ Одобрено. Ждём подтверждения рекламодателя.');

    const kb = html(
      Markup.inlineKeyboard([
        styled(
          Markup.button.callback(
            '✅ Подтвердить',
            `adv:approve:${submission.id}`,
          ),
          'success',
        ),
        styled(
          Markup.button.callback('❌ Отклонить', `adv:reject:${submission.id}`),
          'danger',
        ),
      ]),
    );
    const text = [
      '🎬 Новое видео на проверку',
      '',
      `Заказ: ${escapeHtml(submission.order.title)}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    try {
      await ctx.telegram.sendMessage(
        submission.order.advertiser.telegramId.toString(),
        text,
        kb,
      );
    } catch {
      // рекламодатель мог заблокировать бота
    }
  }

  @Action(/^mod:reject:(\d+)$/)
  async onModReject(@Ctx() ctx: BotContext) {
    if (await this.denied(ctx)) return;
    const id = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(MODERATOR_REJECT_SCENE_ID, { submissionId: id });
  }
}
