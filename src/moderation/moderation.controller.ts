import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { OrderStatus } from '@prisma/client';
import { findContacts } from '../common/contacts';
import { fromMinor } from '../common/money';
import { NotificationsService } from '../telegram/notifications.service';
import { creatorLabel } from '../common/format';
import { payoutPool, VIEWS_TOPUP_DAYS } from '../orders/budget';
import { OrdersService } from '../orders/orders.service';
import { DAY_MS } from '../orders/deadline';
import { platformOf } from '../common/platforms';
import { SubmissionsService } from '../submissions/submissions.service';
import {
  type VideoStats,
  ViewCounterService,
} from '../submissions/view-counter.service';
import { AnalyticsService } from './analytics.service';
import {
  BansService,
  parseBanReason,
  parseReportDecision,
} from './bans.service';
import { PayoutsService } from '../payouts/payouts.service';
import { ReportsService } from '../reports/reports.service';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { ModeratorGuard } from '../auth/moderator.guard';
import {
  parseCpm,
  parseRejectComment,
  parseLikes,
  parseViews,
  videoFormat,
} from '../orders/order-input';

const PAGE_SIZE = 20;

/** Версия заказа, которую модератор видел (`version` из GET /api/mod/orders/:id). */
function parseVersion(body: unknown): Date {
  const raw = (body as { version?: unknown } | null)?.version;
  const version = typeof raw === 'string' ? new Date(raw) : null;
  if (!version || Number.isNaN(version.getTime()))
    throw new BadRequestException('Откройте заказ заново');
  return version;
}

/**
 * Окно модератора в Mini App. Гонки двух модераторов над одним пунктом отсекают условные переходы
 * статусов (src/orders/order-status.ts, src/submissions/submission-status.ts).
 */
@Controller('api/mod')
@UseGuards(InitDataGuard, ModeratorGuard, UserThrottlerGuard)
export class ModerationController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly reports: ReportsService,
    private readonly bans: BansService,
    private readonly payouts: PayoutsService,
    private readonly viewCounter: ViewCounterService,
  ) {}

  /** Обе очереди сразу: заказы и видео на проверке, старые первыми. */
  @Get('queue')
  async queue() {
    const [orders, videos, topups] = await Promise.all([
      this.ordersService.listPending(),
      this.submissionsService.listPendingModeration(),
      this.submissionsService.listTopupDue(),
    ]);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        title: o.title,
        budget: fromMinor(o.budgetMinor),
        advertiser: creatorLabel(o.advertiser),
        // ждёт с момента отправки на проверку: после правки — заново
        queuedAt: o.moderationRequestedAt,
        // похоже на контакты в обход площадки — модератору пометка в списке
        hasContacts:
          findContacts(o.title, o.description, o.referenceUrl).length > 0,
      })),
      videos: videos.map((s) => ({
        id: s.id,
        orderTitle: s.order.title,
        creator: creatorLabel(s.creator),
        submittedAt: s.submittedAt,
      })),
      // добор закончился — зафиксировать итог просмотров
      topups: topups.map((s) => ({
        id: s.id,
        orderTitle: s.order.title,
        creator: creatorLabel(s.creator),
        decidedAt: s.decidedAt,
      })),
    };
  }

  @Get('stats')
  async stats() {
    const [orders, submissions] = await Promise.all([
      this.ordersService.stats(),
      this.submissionsService.stats(),
    ]);
    return { orders, submissions };
  }

  /** Воронка за последние `days` дней (1–365); без параметра — за всё время. */
  @Get('funnel')
  funnel(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    if (days !== undefined && (days < 1 || days > 365))
      throw new BadRequestException('Период — от 1 до 365 дней');
    return this.analytics.funnel(
      days === undefined ? undefined : new Date(Date.now() - days * DAY_MS),
    );
  }

  /** Все заказы любого статуса — страница, новые первыми. */
  @Get('orders')
  async allOrders(
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) rawPage: number,
  ) {
    const page = Math.max(0, rawPage);
    const { items, total } = await this.ordersService.listAll(
      page * PAGE_SIZE,
      PAGE_SIZE,
    );
    return {
      items: items.map((o) => ({
        id: o.id,
        title: o.title,
        budget: fromMinor(o.budgetMinor),
        status: o.status,
        advertiser: creatorLabel(o.advertiser),
        submissionsCount: o._count.submissions,
        createdAt: o.createdAt,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  @Get('orders/:id')
  async order(@Param('id', ParseIdPipe) id: number) {
    const o = await this.ordersService.findWithAdvertiser(id);
    if (!o) throw new NotFoundException('Заказ не найден');
    return {
      id: o.id,
      title: o.title,
      description: o.description,
      referenceUrl: o.referenceUrl,
      ...videoFormat(o),
      budget: fromMinor(o.budgetMinor),
      feePercent: o.feePercent,
      // фонд выплат креаторам — от него модератор считает ставку
      pool: fromMinor(payoutPool(o)),
      minViews: o.minViews,
      cpm: fromMinor(o.cpmMinor),
      category: o.category,
      deadline: o.deadline,
      status: o.status,
      moderatorComment: o.moderatorComment,
      advertiser: creatorLabel(o.advertiser),
      createdAt: o.createdAt,
      contacts: findContacts(o.title, o.description, o.referenceUrl),
      // решение принимается по этой версии — см. OrdersService.moderatorApprove
      version: o.moderationRequestedAt,
    };
  }

  @Post('orders/:id/approve')
  async approveOrder(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const order = await this.ordersService.moderatorApprove(
      id,
      req.user.telegramId,
      parseVersion(body),
      parseCpm(body),
    );
    if (order.status === OrderStatus.CLOSED)
      this.notifications.orderBudgetExhausted(order);
    else {
      this.notifications.orderApproved(order);
      // изменённый заказ после повторной проверки — не новый, второй раз не рассылаем
      if (order.firstPublication) this.notifications.newOrderPublished(order);
    }
    return { ok: true };
  }

  @Post('orders/:id/reject')
  async rejectOrder(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    const order = await this.ordersService.moderatorReject(
      id,
      req.user.telegramId,
      comment,
      parseVersion(body),
    );
    this.notifications.orderRejected(order, comment);
    return { ok: true };
  }

  @Get('videos/:id')
  async video(@Param('id', ParseIdPipe) id: number) {
    const s = await this.submissionsService.findById(id);
    if (!s) throw new NotFoundException('Отклик не найден');
    const [attempt, budget, counted] = await Promise.all([
      this.submissionsService.attemptNumber(s),
      this.submissionsService.orderBudget(s.order),
      s.videoUrl
        ? this.viewCounter.fetchViews([s.videoUrl])
        : new Map<string, VideoStats>(),
    ]);
    return {
      id: s.id,
      status: s.status,
      videoUrl: s.videoUrl,
      submittedAt: s.submittedAt,
      creator: creatorLabel(s.creator),
      creatorId: s.creatorId,
      attempt,
      // на проверке — заявлено креатором, после одобрения — зафиксировано
      views: s.views,
      likes: s.likes,
      // сейчас по данным API площадки; null — считается вручную или API не ответило
      autoViews: counted.get(s.videoUrl ?? '')?.views ?? null,
      autoLikes: counted.get(s.videoUrl ?? '')?.likes ?? null,
      platform: platformOf(s.videoUrl),
      payout: fromMinor(s.payoutMinor),
      decidedAt: s.decidedAt,
      finalizedAt: s.finalizedAt,
      topupDays: VIEWS_TOPUP_DAYS,
      order: {
        id: s.order.id,
        title: s.order.title,
        description: s.order.description,
        ...videoFormat(s.order),
        cpm: fromMinor(s.order.cpmMinor),
        minViews: s.order.minViews,
        free: fromMinor(budget.free),
      },
    };
  }

  /** Открытые жалобы, сгруппированные по объекту. */
  @Get('reports')
  reportsList() {
    return this.reports.listOpen();
  }

  /** Решение по всем жалобам на объект: `actioned` — применить меру, иначе «нарушений нет». */
  @Post('reports/resolve')
  async resolveReports(@Body() body: unknown, @Req() req: ApiRequest) {
    const decision = parseReportDecision(body);
    const { reporters, closedOrder, bannedOrders } =
      await this.bans.resolveReports(decision, req.user.telegramId);
    if (closedOrder) this.notifications.orderClosedByModerator(closedOrder);
    for (const order of bannedOrders)
      this.notifications.orderClosedByModerator(order);
    this.notifications.reportResolved(reporters, decision.actioned);
    return { ok: true };
  }

  @Post('users/:id/ban')
  async ban(@Param('id', ParseIdPipe) id: number, @Body() body: unknown) {
    const reason = parseBanReason(
      (body as { reason?: unknown } | null)?.reason,
    );
    for (const order of await this.bans.banUser(id, reason))
      this.notifications.orderClosedByModerator(order);
    return { ok: true };
  }

  @Post('users/:id/unban')
  async unban(@Param('id', ParseIdPipe) id: number) {
    await this.bans.unban(id);
    return { ok: true };
  }

  /** Удалить отзыв креатору (оскорбления и т.п.); приёмка видео остаётся. */
  @Delete('reviews/:submissionId')
  async removeReview(@Param('submissionId', ParseIdPipe) submissionId: number) {
    await this.submissionsService.removeReview(submissionId);
    return { ok: true };
  }

  /** Одобрить ролик и зафиксировать просмотры (`views`) — выплата начисляется окончательно. `likes` — по желанию. */
  @Post('videos/:id/approve')
  async approveVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body('views') views: unknown,
    @Body('likes') likes: unknown,
    @Req() req: ApiRequest,
  ) {
    const { submission, closed } =
      await this.submissionsService.moderatorApprove(
        id,
        req.user.telegramId,
        parseViews(views),
        parseLikes(likes),
      );
    this.notifications.videoApprovedByModerator(submission);
    if (closed) this.notifications.orderBudgetExhausted(closed);
    return { ok: true };
  }

  /** Итог просмотров после добора: доплата за прирост, пока есть бюджет. */
  @Post('videos/:id/finalize')
  async finalizeVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body('views') views: unknown,
    @Body('likes') likes: unknown,
  ) {
    const { submission, extraMinor, closed } =
      await this.submissionsService.finalizeViews(
        id,
        parseViews(views),
        parseLikes(likes),
      );
    this.notifications.viewsFinalized(submission, extraMinor);
    if (closed) this.notifications.orderBudgetExhausted(closed);
    return { ok: true };
  }

  /** Открытые заявки на вывод, старые первыми. */
  @Get('payouts')
  async payoutsList() {
    return (await this.payouts.listRequested()).map((p) => ({
      id: p.id,
      amount: fromMinor(p.amountMinor),
      wallet: p.wallet,
      creator: creatorLabel(p.creator),
      creatorId: p.creatorId,
      createdAt: p.createdAt,
    }));
  }

  /** Деньги переведены — креатору уведомление. */
  @Post('payouts/:id/paid')
  async payoutPaid(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const payout = await this.payouts.markPaid(id, req.user.telegramId);
    this.notifications.payoutDecided(payout);
    return { ok: true };
  }

  /** Отказ с причиной — сумма возвращается на баланс креатора. */
  @Post('payouts/:id/reject')
  async payoutReject(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const payout = await this.payouts.reject(
      id,
      req.user.telegramId,
      parseRejectComment(body),
    );
    this.notifications.payoutDecided(payout);
    return { ok: true };
  }

  @Post('videos/:id/reject')
  async rejectVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    const submission = await this.submissionsService.moderatorReject(
      id,
      req.user.telegramId,
      comment,
    );
    this.notifications.videoRejectedByModerator(submission, comment);
    return { ok: true };
  }
}
