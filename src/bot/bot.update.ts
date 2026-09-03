import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderCategory } from '@prisma/client';
import { Action, Ctx, Hears, Start, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import type { BotContext } from './interfaces/bot-context.interface';
import { getCurrentUser } from './interfaces/bot-context.interface';
import {
  MODERATOR_MENU_BUTTONS,
  USER_MENU_BUTTONS,
  moderatorMenuKeyboard,
  userMenuKeyboard,
} from './keyboards/menu.keyboard';
import { SUBMIT_VIDEO_SCENE_ID } from './scenes/submit-video.scene';
import { CREATE_ORDER_SCENE_ID } from './scenes/create-order.scene';
import { MODERATOR_REJECT_SCENE_ID } from './scenes/moderator-reject.scene';
import { ADVERTISER_REJECT_SCENE_ID } from './scenes/advertiser-reject.scene';
import { ORDER_REJECT_SCENE_ID } from './scenes/order-reject.scene';
import { styled } from './utils/button.util';
import {
  escapeHtml,
  formatOrderCard,
  formatSubmissionCard,
  html,
  ORDER_CATEGORIES,
  orderCategoryLabel,
  orderGroupLabel,
  submissionAttemptLabel,
  submissionForAdvertiserLabel,
} from './utils/format';
import { isModerator, parseModeratorIds } from './utils/moderator.util';

const PAGE_SIZE = 5;

/**
 * Only our own deliberate ForbiddenException/NotFoundException messages are safe to show a user —
 * anything else (a raw Prisma/network error, a bug) could leak internal details, so fall back to a
 * generic message and let it surface through the app-wide logger instead.
 */
function errorMessage(err: unknown): string {
  if (err instanceof ForbiddenException || err instanceof NotFoundException) {
    return err.message;
  }
  Logger.error(err, undefined, 'BotUpdate');
  return 'Не удалось выполнить действие';
}

function shortIntroText(): string {
  return [
    '👋 CreON — биржа заказов на видео.',
    '',
    'Рекламодатели публикуют задания, креаторы берутся за них и получают оплату за готовую работу.',
  ].join('\n');
}

function howItWorksText(): string {
  return [
    'ℹ️ Как это работает',
    '',
    '1️⃣ Рекламодатель размещает заказ — что снять и какие требования',
    '2️⃣ Модератор проверяет заказ и публикует его',
    '3️⃣ Креатор откликается, а когда видео готово — присылает ссылку',
    '4️⃣ Модератор проверяет ролик',
    '5️⃣ Рекламодатель смотрит и подтверждает — заказ выполнен 🎉',
    '',
    'Вы можете быть и заказчиком, и исполнителем — в меню под сообщением есть разделы для обеих ролей.',
  ].join('\n');
}

@Update()
export class BotUpdate {
  private readonly moderatorIds: Set<string>;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly config: ConfigService,
  ) {
    this.moderatorIds = parseModeratorIds(
      this.config.get<string>('MODERATOR_IDS'),
    );
  }

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
    await this.showWelcome(ctx);
  }

  private async showWelcome(ctx: BotContext) {
    if (isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.reply(
        [
          '🛡 CreON Moderation',
          '',
          'Вы — модератор площадки: проверяете новые заказы перед публикацией и готовые видео перед тем, как они попадут к рекламодателю.',
          '',
          '🆕 Заказы на проверку — новые заказы, ждущие публикации',
          '🎬 Видео на проверку — готовые работы креаторов',
          '📋 Все заказы — полный список заказов на площадке',
          '📊 Статистика — сводка по заказам и откликам',
        ].join('\n'),
        moderatorMenuKeyboard(),
      );
      return;
    }
    await ctx.reply(
      shortIntroText(),
      html(
        Markup.inlineKeyboard([
          [
            styled(
              Markup.button.callback(
                'ℹ️ Как это работает',
                'info:how-it-works',
              ),
              'primary',
            ),
          ],
        ]),
      ),
    );
    await ctx.reply('Выберите действие в меню 👇', userMenuKeyboard());
  }

  @Action('info:how-it-works')
  async onHowItWorks(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      howItWorksText(),
      html(
        Markup.inlineKeyboard([
          [styled(Markup.button.callback('◀️ Назад', 'info:back'), 'primary')],
        ]),
      ),
    );
  }

  @Action('info:back')
  async onInfoBack(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      shortIntroText(),
      html(
        Markup.inlineKeyboard([
          [
            styled(
              Markup.button.callback(
                'ℹ️ Как это работает',
                'info:how-it-works',
              ),
              'primary',
            ),
          ],
        ]),
      ),
    );
  }

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
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  @Action(/^browsecat:(.+)$/)
  async onBrowseCategoryPicked(@Ctx() ctx: BotContext) {
    const category = (ctx as unknown as { match: RegExpMatchArray }).match[1];
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
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    const filter = category === 'all' ? undefined : (category as OrderCategory);
    const { order, total } = await this.ordersService.getOpenAt(index, filter);
    const categoryButton = styled(
      Markup.button.callback(
        `🏷 ${filter ? orderCategoryLabel(filter) : 'Все категории'}`,
        'browse:cat',
      ),
      'primary',
    );
    if (!order) {
      const text = 'Заказов в этой категории пока нет.';
      const kb = html(Markup.inlineKeyboard([[categoryButton]]));
      if (edit) await ctx.editMessageText(text, kb);
      else await ctx.reply(text, kb);
      return;
    }
    const text = formatOrderCard(order);
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [categoryButton],
    ];
    if (total > 1) {
      rows.push([
        index > 0
          ? Markup.button.callback('◀️', `browse:${index - 1}:${category}`)
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${index + 1} / ${total}`, 'noop'),
        index + 1 < total
          ? Markup.button.callback('▶️', `browse:${index + 1}:${category}`)
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  @Action('noop')
  async onNoop(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
  }

  @Action('browse:close')
  async onBrowseClose(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('Список закрыт.');
    }
  }

  @Action(/^respond:(\d+):(\d+):(.+)$/)
  async onRespond(@Ctx() ctx: BotContext) {
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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

  @Hears(USER_MENU_BUTTONS.MY_ORDERS)
  async onMyOrders(@Ctx() ctx: BotContext) {
    await this.sendMyOrderCard(ctx, 0);
  }

  @Action(/^myorders:nav:(\d+)$/)
  async onMyOrdersNav(@Ctx() ctx: BotContext) {
    const index = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await this.sendMyOrderCard(ctx, index, true);
  }

  /** Level 1: one full order card at a time (own orders), same carousel pattern as browsing open orders. */
  private async sendMyOrderCard(ctx: BotContext, index: number, edit = false) {
    const all = await this.ordersService.listByAdvertiser(
      getCurrentUser(ctx).id,
    );
    if (all.length === 0) {
      const text = 'У вас пока нет заказов.';
      if (edit) await ctx.editMessageText(text);
      else await ctx.reply(text);
      return;
    }
    const total = all.length;
    const order = all[Math.min(index, total - 1)];
    const text = `${formatOrderCard(order, order.submissions)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push([
        index > 0
          ? Markup.button.callback('◀️', `myorders:nav:${index - 1}`)
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${index + 1} / ${total}`, 'noop'),
        index + 1 < total
          ? Markup.button.callback('▶️', `myorders:nav:${index + 1}`)
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  @Action('myorders:close')
  async onMyOrdersClose(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('Список закрыт.');
    }
  }

  /** Notifies every distinct creator who has a submission on this order (dedupes multiple attempts by the same creator). */
  private async notifyOrderCreators(
    ctx: BotContext,
    submissions: { creator: { telegramId: bigint } }[],
    text: string,
  ) {
    const seen = new Set<string>();
    for (const s of submissions) {
      const chatId = s.creator.telegramId.toString();
      if (seen.has(chatId)) continue;
      seen.add(chatId);
      try {
        await ctx.telegram.sendMessage(chatId, text, html());
      } catch {
        // креатор мог заблокировать бота
      }
    }
  }

  @Action(/^close:(\d+):(\d+)$/)
  async onCloseOrder(@Ctx() ctx: BotContext) {
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    await this.notifyOrderCreators(
      ctx,
      order.submissions,
      `🔒 Заказ «${escapeHtml(order.title)}» закрыт рекламодателем. Новые отклики по нему больше не принимаются.`,
    );
    await this.sendMyOrderCard(ctx, index, true);
  }

  @Action(/^myorders:delete-confirm:(\d+):(\d+)$/)
  async onDeleteOrderConfirm(@Ctx() ctx: BotContext) {
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    await this.notifyOrderCreators(
      ctx,
      order.submissions,
      `🗑 Заказ «${escapeHtml(order.title)}» удалён рекламодателем. Отклик по нему больше не актуален.`,
    );
    await this.sendMyOrderCard(ctx, Math.max(0, index - 1), true);
  }

  /** Level 2: responses submitted for one specific order (own orders), same list-then-detail pattern as "Мои отклики". */
  @Action(/^myorders:subs:(\d+):(\d+)$/)
  async onMyOrderSubmissions(@Ctx() ctx: BotContext) {
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
      rows.push([
        page > 0
          ? Markup.button.callback(
              '◀️',
              `myorders:subs-page:${orderId}:${orderIndex}:${page - 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${page + 1} / ${totalPages}`, 'noop'),
        page + 1 < totalPages
          ? Markup.button.callback(
              '▶️',
              `myorders:subs-page:${orderId}:${orderIndex}:${page + 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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

  @Hears(USER_MENU_BUTTONS.MY_SUBMISSIONS)
  async onMySubmissions(@Ctx() ctx: BotContext) {
    await this.sendSubmissionOrdersList(ctx, 0);
  }

  @Action(/^subs:page:(\d+)$/)
  async onSubmissionsPage(@Ctx() ctx: BotContext) {
    const page = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await this.sendSubmissionOrdersList(ctx, page, true);
  }

  /** Level 1: one button per order the creator has submissions for, with an attempt count. */
  private async sendSubmissionOrdersList(
    ctx: BotContext,
    page: number,
    edit = false,
  ) {
    const all = await this.submissionsService.listByCreator(
      getCurrentUser(ctx).id,
    );
    if (all.length === 0) {
      const text =
        'У вас пока нет откликов. Загляните в «🔍 Доступные заказы».';
      if (edit) await ctx.editMessageText(text);
      else await ctx.reply(text);
      return;
    }
    const groups = new Map<
      number,
      { order: (typeof all)[number]['order']; count: number }
    >();
    for (const s of all) {
      const existing = groups.get(s.orderId);
      if (existing) existing.count += 1;
      else groups.set(s.orderId, { order: s.order, count: 1 });
    }
    const orderGroups = [...groups.values()];
    const totalPages = Math.max(1, Math.ceil(orderGroups.length / PAGE_SIZE));
    const items = orderGroups.slice(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE,
    );
    const text = `📝 <b>Мои отклики</b> (${all.length})\n\nВыберите заказ:`;
    const rows = items.map((g) => [
      Markup.button.callback(
        orderGroupLabel(g.order, g.count),
        `subs:order:${g.order.id}`,
      ),
    ]);
    if (totalPages > 1) {
      rows.push([
        page > 0
          ? Markup.button.callback('◀️', `subs:page:${page - 1}`)
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${page + 1} / ${totalPages}`, 'noop'),
        page + 1 < totalPages
          ? Markup.button.callback('▶️', `subs:page:${page + 1}`)
          : Markup.button.callback(' ', 'noop'),
      ]);
    }
    rows.push([
      styled(Markup.button.callback('✖️ Закрыть', 'subs:close'), 'danger'),
    ]);
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  @Action('subs:close')
  async onSubmissionsClose(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('Список закрыт.');
    }
  }

  /** Level 2: attempts (submissions) for one specific order. */
  @Action(/^subs:order:(\d+)$/)
  async onSubmissionsForOrder(@Ctx() ctx: BotContext) {
    const orderId = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await this.renderOrderSubmissions(ctx, orderId, 0);
  }

  @Action(/^subs:order-page:(\d+):(\d+)$/)
  async onSubmissionsForOrderPage(@Ctx() ctx: BotContext) {
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
    const orderId = Number(match[1]);
    const page = Number(match[2]);
    await ctx.answerCbQuery();
    await this.renderOrderSubmissions(ctx, orderId, page);
  }

  /** Claims a fresh attempt and jumps straight into the "send video" flow, instead of a separate claim-then-find-it-again step. */
  @Action(/^subs:resubmit:(\d+)$/)
  async onSubmissionsResubmit(@Ctx() ctx: BotContext) {
    const orderId = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    let submission: Awaited<ReturnType<typeof this.submissionsService.claim>>;
    try {
      submission = await this.submissionsService.claim(
        orderId,
        getCurrentUser(ctx).id,
      );
    } catch (err) {
      await ctx.answerCbQuery(errorMessage(err), { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.scene.enter(SUBMIT_VIDEO_SCENE_ID, {
      submissionId: submission.id,
    });
  }

  private async renderOrderSubmissions(
    ctx: BotContext,
    orderId: number,
    page: number,
  ) {
    const all = await this.submissionsService.listByCreator(
      getCurrentUser(ctx).id,
    );
    const items = all.filter((s) => s.orderId === orderId);
    if (items.length === 0) {
      await ctx.answerCbQuery('Отклики не найдены', { show_alert: true });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageItems = items.slice(
      page * PAGE_SIZE,
      page * PAGE_SIZE + PAGE_SIZE,
    );
    const hasActive = items.some(
      (s) =>
        s.status === 'IN_PROGRESS' ||
        s.status === 'SUBMITTED' ||
        s.status === 'MODERATOR_APPROVED',
    );
    const order = items[0].order;
    const canResubmit = !hasActive && order.status === 'OPEN';
    const text = [
      `📦 <b>Заказ #${orderId} — ${escapeHtml(order.title)}</b>`,
      '',
      'Ваши отклики:',
      ...(hasActive
        ? [
            '',
            'ℹ️ Новый отклик будет доступен, когда модератор или рекламодатель примет решение по текущему.',
          ]
        : []),
      ...(!hasActive && order.status !== 'OPEN'
        ? ['', '🔒 Заказ закрыт — новые отклики по нему больше не принимаются.']
        : []),
    ].join('\n');
    const rows = pageItems.map((s) => [
      Markup.button.callback(submissionAttemptLabel(s), `sub:view:${s.id}`),
    ]);
    if (totalPages > 1) {
      rows.push([
        page > 0
          ? Markup.button.callback(
              '◀️',
              `subs:order-page:${orderId}:${page - 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${page + 1} / ${totalPages}`, 'noop'),
        page + 1 < totalPages
          ? Markup.button.callback(
              '▶️',
              `subs:order-page:${orderId}:${page + 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
      ]);
    }
    if (canResubmit) {
      rows.push([
        styled(
          Markup.button.callback(
            '📤 Отправить новую работу',
            `subs:resubmit:${orderId}`,
          ),
          'success',
        ),
      ]);
    }
    rows.push([
      styled(Markup.button.callback('◀️ К заказам', 'subs:page:0'), 'primary'),
    ]);
    await ctx.editMessageText(text, html(Markup.inlineKeyboard(rows)));
  }

  /** Level 3: full detail for one submission. */
  @Action(/^sub:view:(\d+)$/)
  async onSubmissionView(@Ctx() ctx: BotContext) {
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
    const submission = await this.submissionsService.findById(id);
    if (!submission || submission.creatorId !== getCurrentUser(ctx).id) {
      await ctx.answerCbQuery('Отклик не найден', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (submission.status === 'IN_PROGRESS') {
      rows.push([
        styled(
          Markup.button.callback(
            '📤 Отправить работу',
            `respond-work:${submission.id}`,
          ),
          'success',
        ),
      ]);
    }
    rows.push([
      styled(
        Markup.button.callback('◀️ Назад', `subs:order:${submission.orderId}`),
        'primary',
      ),
    ]);
    await ctx.editMessageText(
      formatSubmissionCard(submission),
      html(Markup.inlineKeyboard(rows)),
    );
  }

  @Action(/^respond-work:(\d+)$/)
  async onRespondWork(@Ctx() ctx: BotContext) {
    const submissionId = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await ctx.scene.enter(SUBMIT_VIDEO_SCENE_ID, { submissionId });
  }

  @Hears(MODERATOR_MENU_BUTTONS.ORDER_QUEUE)
  async onOrderQueue(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) return;
    await this.sendPendingOrderCard(ctx, 0);
  }

  @Action(/^modq:nav:(\d+)$/)
  async onModQueueNav(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const index = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await this.sendPendingOrderCard(ctx, index, true);
  }

  @Action('modq:close')
  async onModQueueClose(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('Очередь закрыта.');
    }
  }

  /** Moderator's "orders awaiting review" carousel — one pending order at a time. */
  private async sendPendingOrderCard(
    ctx: BotContext,
    index: number,
    edit = false,
  ) {
    const { order, total } = await this.ordersService.getPendingAt(index);
    if (!order) {
      const text = 'Заказов на проверку нет.';
      if (edit) await ctx.editMessageText(text);
      else await ctx.reply(text);
      return;
    }
    const text = `${formatOrderCard(order, undefined, true)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push([
        index > 0
          ? Markup.button.callback('◀️', `modq:nav:${index - 1}`)
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${index + 1} / ${total}`, 'noop'),
        index + 1 < total
          ? Markup.button.callback('▶️', `modq:nav:${index + 1}`)
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  @Action(/^order:approve:(\d+)$/)
  async onOrderApprove(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(ORDER_REJECT_SCENE_ID, { orderId: id });
  }

  @Hears(MODERATOR_MENU_BUTTONS.ALL_ORDERS)
  async onAllOrders(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) return;
    await this.sendAllOrderCard(ctx, 0);
  }

  @Action(/^all-orders:nav:(\d+)$/)
  async onAllOrdersNav(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const index = Number(
      (ctx as unknown as { match: RegExpMatchArray }).match[1],
    );
    await ctx.answerCbQuery();
    await this.sendAllOrderCard(ctx, index, true);
  }

  @Action('all-orders:close')
  async onAllOrdersClose(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('Список закрыт.');
    }
  }

  /** Moderator's full oversight carousel — every order regardless of status, one at a time. */
  private async sendAllOrderCard(ctx: BotContext, index: number, edit = false) {
    const { order, total } = await this.ordersService.getAllAt(index);
    if (!order) {
      const text = 'Заказов пока нет.';
      if (edit) await ctx.editMessageText(text);
      else await ctx.reply(text);
      return;
    }
    const text = `${formatOrderCard(order, order.submissions, true)}\n\n(${index + 1} из ${total})`;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (total > 1) {
      rows.push([
        index > 0
          ? Markup.button.callback('◀️', `all-orders:nav:${index - 1}`)
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${index + 1} / ${total}`, 'noop'),
        index + 1 < total
          ? Markup.button.callback('▶️', `all-orders:nav:${index + 1}`)
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    const kb = html(Markup.inlineKeyboard(rows));
    if (edit) await ctx.editMessageText(text, kb);
    else await ctx.reply(text, kb);
  }

  /** Read-only responses list for one order, reachable from the "all orders" oversight carousel. */
  @Action(/^allorders:subs:(\d+):(\d+)$/)
  async onAllOrdersSubmissions(@Ctx() ctx: BotContext) {
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
      rows.push([
        page > 0
          ? Markup.button.callback(
              '◀️',
              `allorders:subs-page:${orderId}:${orderIndex}:${page - 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
        Markup.button.callback(`${page + 1} / ${totalPages}`, 'noop'),
        page + 1 < totalPages
          ? Markup.button.callback(
              '▶️',
              `allorders:subs-page:${orderId}:${orderIndex}:${page + 1}`,
            )
          : Markup.button.callback(' ', 'noop'),
      ]);
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const match = (ctx as unknown as { match: RegExpMatchArray }).match;
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) return;
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) return;
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
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
      `Заказ: ${submission.order.title}`,
      `Видео: ${submission.videoUrl}`,
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
    if (!isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.answerCbQuery('Недостаточно прав');
      return;
    }
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(MODERATOR_REJECT_SCENE_ID, { submissionId: id });
  }

  @Action(/^adv:approve:(\d+)$/)
  async onAdvApprove(@Ctx() ctx: BotContext) {
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
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
    try {
      await ctx.telegram.sendMessage(
        submission.creator.telegramId.toString(),
        `🎉 Рекламодатель подтвердил ваше видео по заказу «${submission.order.title}»!`,
      );
    } catch {
      // креатор мог заблокировать бота
    }
  }

  @Action(/^adv:reject:(\d+)$/)
  async onAdvReject(@Ctx() ctx: BotContext) {
    const id = Number((ctx as unknown as { match: RegExpMatchArray }).match[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(ADVERTISER_REJECT_SCENE_ID, { submissionId: id });
  }
}
