import type { OrderCategory } from '@prisma/client';
import { Action, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../../orders/orders.service';
import { SubmissionsService } from '../../submissions/submissions.service';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { USER_MENU_BUTTONS } from '../keyboards/menu.keyboard';
import { CREATE_ORDER_SCENE_ID } from '../scenes/create-order.scene';
import { styled } from '../utils/button.util';
import { errorMessage } from '../utils/error.util';
import {
  formatOrderCard,
  html,
  ORDER_CATEGORIES,
  orderCategoryLabel,
} from '../utils/format';
import { closeMessage, getMatch, navRow, replyOrEdit } from '../utils/ui.util';

/** Лента открытых заказов для креатора (по категориям) и отклик на заказ; плюс вход в создание заказа. */
@Update()
export class BrowseUpdate {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  @Hears(USER_MENU_BUTTONS.CREATE_ORDER)
  async onCreateOrder(@Ctx() ctx: BotContext) {
    await ctx.scene.enter(CREATE_ORDER_SCENE_ID);
  }

  @Hears(USER_MENU_BUTTONS.BROWSE_ORDERS)
  async onBrowseOrders(@Ctx() ctx: BotContext) {
    await this.sendCategoryPicker(ctx);
  }

  private async sendCategoryPicker(ctx: BotContext, edit = false) {
    const text = '🔍 <b>Доступные заказы</b>\n\nВыберите категорию:';
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [
        styled(
          Markup.button.callback('🔎 Все категории', 'browsecat:all'),
          'primary',
        ),
      ],
    ];
    for (let i = 0; i < ORDER_CATEGORIES.length; i += 2) {
      rows.push(
        ORDER_CATEGORIES.slice(i, i + 2).map((c) =>
          styled(
            Markup.button.callback(c.label, `browsecat:${c.code}`),
            'primary',
          ),
        ),
      );
    }
    await replyOrEdit(ctx, text, html(Markup.inlineKeyboard(rows)), edit);
  }

  @Action(/^browsecat:(.+)$/)
  async onBrowseCategoryPicked(@Ctx() ctx: BotContext) {
    const category = getMatch(ctx)[1];
    await ctx.answerCbQuery();
    await this.sendOrderCard(ctx, 0, category, true);
  }

  @Action('browse:cat')
  async onBrowseChangeCategory(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await this.sendCategoryPicker(ctx, true);
  }

  @Action(/^browse:(\d+):(.+)$/)
  async onBrowseNav(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const index = Number(match[1]);
    const category = match[2];
    await ctx.answerCbQuery();
    await this.sendOrderCard(ctx, index, category, true);
  }

  private async sendOrderCard(
    ctx: BotContext,
    index: number,
    category: string,
    edit = false,
  ) {
    const filter =
      category === 'all' || !ORDER_CATEGORIES.some((c) => c.code === category)
        ? undefined
        : (category as OrderCategory);
    let { order, total } = await this.ordersService.getOpenAt(index, filter);
    if (!order && total > 0) {
      // Список схлопнулся (другой заказ закрыли/удалили), пока мы сидели на странице за пределами — откатываемся назад.
      index = total - 1;
      ({ order, total } = await this.ordersService.getOpenAt(index, filter));
    }
    const categoryButton = styled(
      Markup.button.callback(
        `🏷 ${filter ? orderCategoryLabel(filter) : 'Все категории'}`,
        'browse:cat',
      ),
      'primary',
    );
    if (!order) {
      await replyOrEdit(
        ctx,
        'Заказов в этой категории пока нет.',
        html(Markup.inlineKeyboard([[categoryButton]])),
        edit,
      );
      return;
    }
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [categoryButton],
    ];
    if (total > 1) {
      rows.push(navRow(index, total, (i) => `browse:${i}:${category}`));
    }
    const alreadyClaimed = await this.submissionsService.hasActiveClaim(
      order.id,
      getCurrentUser(ctx).id,
    );
    rows.push([
      alreadyClaimed
        ? styled(
            Markup.button.callback(
              '📝 Вы уже откликнулись',
              `subs:order:${order.id}`,
            ),
            'primary',
          )
        : styled(
            Markup.button.callback(
              '✅ Откликнуться',
              `respond:${order.id}:${index}:${category}`,
            ),
            'success',
          ),
    ]);
    rows.push([
      styled(Markup.button.callback('✖️ Закрыть', 'browse:close'), 'danger'),
    ]);
    await replyOrEdit(
      ctx,
      formatOrderCard(order),
      html(Markup.inlineKeyboard(rows)),
      edit,
    );
  }

  @Action('browse:close')
  async onBrowseClose(@Ctx() ctx: BotContext) {
    await closeMessage(ctx);
  }

  @Action(/^respond:(\d+):(\d+):(.+)$/)
  async onRespond(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const orderId = Number(match[1]);
    const index = Number(match[2]);
    const category = match[3];
    try {
      await this.submissionsService.claim(orderId, getCurrentUser(ctx).id);
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err), { show_alert: true });
      return;
    }
    await ctx.answerCbQuery(
      `✅ Заказ #${orderId} взят в работу. Когда видео будет готово — откройте «${USER_MENU_BUTTONS.MY_SUBMISSIONS}» и нажмите «📤 Отправить работу».`,
      { show_alert: true },
    );
    await this.sendOrderCard(ctx, index, category, true);
  }
}
