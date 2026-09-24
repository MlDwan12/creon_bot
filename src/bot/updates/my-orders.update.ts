import { Action, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../orders/orders.service';
import { SubmissionsService } from '../../submissions/submissions.service';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { USER_MENU_BUTTONS } from '../keyboards/menu.keyboard';
import { NotificationsService } from '../notifications.service';
import { ADVERTISER_REJECT_SCENE_ID } from '../scenes/advertiser-reject.scene';
import { styled } from '../utils/button.util';
import { errorMessage } from '../utils/error.util';
import {
  escapeHtml,
  formatOrderCard,
  formatSubmissionCard,
  html,
  submissionForAdvertiserLabel,
} from '../utils/format';
import {
  closeMessage,
  getMatch,
  navRow,
  PAGE_SIZE,
  replyOrEdit,
} from '../utils/ui.util';

/** «Мои заказы» рекламодателя: карусель своих заказов, закрытие/удаление, отклики и решение по видео. */
@Update()
export class MyOrdersUpdate {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Hears(USER_MENU_BUTTONS.MY_ORDERS)
  async onMyOrders(@Ctx() ctx: BotContext) {
    await this.sendMyOrderCard(ctx, 0);
  }

  @Action(/^myorders:nav:(\d+)$/)
  async onMyOrdersNav(@Ctx() ctx: BotContext) {
    const index = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await this.sendMyOrderCard(ctx, index, true);
  }

  /** Level 1: one full order card at a time (own orders), same carousel pattern as browsing open orders. */
  private async sendMyOrderCard(ctx: BotContext, index: number, edit = false) {
    const all = await this.ordersService.listByAdvertiser(
      getCurrentUser(ctx).id,
    );
    if (all.length === 0) {
      await replyOrEdit(ctx, 'У вас пока нет заказов.', undefined, edit);
      return;
    }
    const total = all.length;
    const order = all[Math.min(index, total - 1)];
    const text = `${formatOrderCard(order, order.submissions)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push(navRow(index, total, (i) => `myorders:nav:${i}`));
    }
    if (order.submissions.length > 0) {
      rows.push([
        styled(
          Markup.button.callback(
            `📥 Отклики (${order.submissions.length})`,
            `myorders:subs:${order.id}:${index}`,
          ),
          'primary',
        ),
      ]);
    }
    if (order.status === 'OPEN') {
      rows.push([
        styled(
          Markup.button.callback(
            '🔒 Закрыть заказ',
            `close:${order.id}:${index}`,
          ),
          'primary',
        ),
      ]);
    }
    rows.push([
      styled(
        Markup.button.callback(
          '🗑 Удалить заказ',
          `myorders:delete-confirm:${order.id}:${index}`,
        ),
        'danger',
      ),
    ]);
    rows.push([
      styled(Markup.button.callback('✖️ Закрыть', 'myorders:close'), 'danger'),
    ]);
    await replyOrEdit(ctx, text, html(Markup.inlineKeyboard(rows)), edit);
  }

  @Action('myorders:close')
  async onMyOrdersClose(@Ctx() ctx: BotContext) {
    await closeMessage(ctx);
  }

  @Action(/^close:(\d+):(\d+)$/)
  async onCloseOrder(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const orderId = Number(match[1]);
    const index = Number(match[2]);
    let order: Awaited<ReturnType<typeof this.ordersService.close>>;
    try {
      order = await this.ordersService.close(orderId, getCurrentUser(ctx).id);
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err), { show_alert: true });
      return;
    }
    await ctx.answerCbQuery('Заказ закрыт');
    await this.notifications.orderClosed(order);
    await this.sendMyOrderCard(ctx, index, true);
  }

  @Action(/^myorders:delete-confirm:(\d+):(\d+)$/)
  async onDeleteOrderConfirm(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const orderId = Number(match[1]);
    const index = Number(match[2]);
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '⚠️ Точно удалить заказ? Это необратимо — вместе с ним удалятся все отклики на него.',
      html(
        Markup.inlineKeyboard([
          [
            styled(
              Markup.button.callback(
                '🗑 Да, удалить',
                `myorders:delete:${orderId}:${index}`,
              ),
              'danger',
            ),
            styled(
              Markup.button.callback('✖️ Отмена', `myorders:nav:${index}`),
              'primary',
            ),
          ],
        ]),
      ),
    );
  }

  @Action(/^myorders:delete:(\d+):(\d+)$/)
  async onDeleteOrder(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const orderId = Number(match[1]);
    const index = Number(match[2]);
    let order: Awaited<ReturnType<typeof this.ordersService.remove>>;
    try {
      order = await this.ordersService.remove(orderId, getCurrentUser(ctx).id);
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err), { show_alert: true });
      return;
    }
    await ctx.answerCbQuery('Заказ удалён');
    await this.notifications.orderRemoved(order);
    await this.sendMyOrderCard(ctx, Math.max(0, index - 1), true);
  }

  /** Level 2: responses submitted for one specific order (own orders), same list-then-detail pattern as "Мои отклики". */
  @Action(/^myorders:subs:(\d+):(\d+)$/)
  async onMyOrderSubmissions(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    await ctx.answerCbQuery();
    await this.renderMyOrderSubmissions(
      ctx,
      Number(match[1]),
      Number(match[2]),
      0,
    );
  }

  @Action(/^myorders:subs-page:(\d+):(\d+):(\d+)$/)
  async onMyOrderSubmissionsPage(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    await ctx.answerCbQuery();
    await this.renderMyOrderSubmissions(
      ctx,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  private async renderMyOrderSubmissions(
    ctx: BotContext,
    orderId: number,
    orderIndex: number,
    page: number,
  ) {
    const order = await this.ordersService.findById(orderId);
    if (!order || order.advertiserId !== getCurrentUser(ctx).id) {
      await ctx.answerCbQuery('Заказ не найден', { show_alert: true });
      return;
    }
    const items = await this.submissionsService.listByOrder(orderId);
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageItems = items.slice(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE,
    );
    const text = `📥 <b>Отклики — заказ #${orderId}</b> ${escapeHtml(order.title)}\n\nВыберите отклик:`;
    const rows = pageItems.map((s) => [
      Markup.button.callback(
        submissionForAdvertiserLabel(s),
        `myorders:sub:${s.id}:${orderId}:${orderIndex}`,
      ),
    ]);
    if (totalPages > 1) {
      rows.push(
        navRow(
          page,
          totalPages,
          (p) => `myorders:subs-page:${orderId}:${orderIndex}:${p}`,
        ),
      );
    }
    rows.push([
      styled(
        Markup.button.callback('◀️ К заказу', `myorders:nav:${orderIndex}`),
        'primary',
      ),
    ]);
    await ctx.editMessageText(text, html(Markup.inlineKeyboard(rows)));
  }

  /** Level 3: full detail for one response to an own order, with confirm/reject if it's awaiting the advertiser's decision. */
  @Action(/^myorders:sub:(\d+):(\d+):(\d+)$/)
  async onMyOrderSubmissionView(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const submissionId = Number(match[1]);
    const orderId = Number(match[2]);
    const orderIndex = Number(match[3]);
    const submission = await this.submissionsService.findById(submissionId);
    if (
      !submission ||
      submission.order.advertiserId !== getCurrentUser(ctx).id
    ) {
      await ctx.answerCbQuery('Отклик не найден', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (submission.status === 'MODERATOR_APPROVED') {
      rows.push([
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
      ]);
    }
    rows.push([
      styled(
        Markup.button.callback(
          '◀️ Назад',
          `myorders:subs:${orderId}:${orderIndex}`,
        ),
        'primary',
      ),
    ]);
    await ctx.editMessageText(
      formatSubmissionCard(submission, true),
      html(Markup.inlineKeyboard(rows)),
    );
  }

  @Action(/^adv:approve:(\d+)$/)
  async onAdvApprove(@Ctx() ctx: BotContext) {
    const id = Number(getMatch(ctx)[1]);
    let submission: Awaited<
      ReturnType<typeof this.submissionsService.advertiserApprove>
    >;
    try {
      submission = await this.submissionsService.advertiserApprove(
        id,
        getCurrentUser(ctx).id,
      );
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err));
      return;
    }
    await ctx.answerCbQuery('Подтверждено');
    await ctx.editMessageText('✅ Подтверждено.');
    await this.notifications.videoAccepted(submission);
  }

  @Action(/^adv:reject:(\d+)$/)
  async onAdvReject(@Ctx() ctx: BotContext) {
    const id = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(ADVERTISER_REJECT_SCENE_ID, { submissionId: id });
  }
}
