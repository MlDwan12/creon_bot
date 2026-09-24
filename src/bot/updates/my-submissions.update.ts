import { Action, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { SubmissionsService } from '../../submissions/submissions.service';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { USER_MENU_BUTTONS } from '../keyboards/menu.keyboard';
import { SUBMIT_VIDEO_SCENE_ID } from '../scenes/submit-video.scene';
import { styled } from '../utils/button.util';
import { errorMessage } from '../utils/error.util';
import {
  escapeHtml,
  formatSubmissionCard,
  html,
  orderGroupLabel,
  submissionAttemptLabel,
} from '../utils/format';
import {
  closeMessage,
  getMatch,
  navRow,
  PAGE_SIZE,
  replyOrEdit,
} from '../utils/ui.util';

/** «Мои отклики» креатора: заказы → попытки по заказу → карточка попытки и отправка видео. */
@Update()
export class MySubmissionsUpdate {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Hears(USER_MENU_BUTTONS.MY_SUBMISSIONS)
  async onMySubmissions(@Ctx() ctx: BotContext) {
    await this.sendSubmissionOrdersList(ctx, 0);
  }

  @Action(/^subs:page:(\d+)$/)
  async onSubmissionsPage(@Ctx() ctx: BotContext) {
    const page = Number(getMatch(ctx)[1]);
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
      await replyOrEdit(
        ctx,
        'У вас пока нет откликов. Загляните в «🔍 Доступные заказы».',
        undefined,
        edit,
      );
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
      rows.push(navRow(page, totalPages, (p) => `subs:page:${p}`));
    }
    rows.push([
      styled(Markup.button.callback('✖️ Закрыть', 'subs:close'), 'danger'),
    ]);
    await replyOrEdit(ctx, text, html(Markup.inlineKeyboard(rows)), edit);
  }

  @Action('subs:close')
  async onSubmissionsClose(@Ctx() ctx: BotContext) {
    await closeMessage(ctx);
  }

  /** Level 2: attempts (submissions) for one specific order. */
  @Action(/^subs:order:(\d+)$/)
  async onSubmissionsForOrder(@Ctx() ctx: BotContext) {
    const orderId = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await this.renderOrderSubmissions(ctx, orderId, 0);
  }

  @Action(/^subs:order-page:(\d+):(\d+)$/)
  async onSubmissionsForOrderPage(@Ctx() ctx: BotContext) {
    const match = getMatch(ctx);
    const orderId = Number(match[1]);
    const page = Number(match[2]);
    await ctx.answerCbQuery();
    await this.renderOrderSubmissions(ctx, orderId, page);
  }

  /** Claims a fresh attempt and jumps straight into the "send video" flow, instead of a separate claim-then-find-it-again step. */
  @Action(/^subs:resubmit:(\d+)$/)
  async onSubmissionsResubmit(@Ctx() ctx: BotContext) {
    const orderId = Number(getMatch(ctx)[1]);
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
      rows.push(
        navRow(page, totalPages, (p) => `subs:order-page:${orderId}:${p}`),
      );
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
    const id = Number(getMatch(ctx)[1]);
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
    const submissionId = Number(getMatch(ctx)[1]);
    await ctx.answerCbQuery();
    await ctx.scene.enter(SUBMIT_VIDEO_SCENE_ID, { submissionId });
  }
}
