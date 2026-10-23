import { isDbDate } from '../common/validation';
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
import { Throttle } from '@nestjs/throttler';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ModeratorActionType, OrderStatus } from '@prisma/client';
import { findContacts } from '../common/contacts';
import { fromMinor } from '../common/money';
import { NotificationsService } from '../telegram/notifications.service';
import { creatorLabel } from '../common/format';
import { budgetRaised, payoutPool, HOLD_DAYS } from '../orders/budget';
import { OrdersService } from '../orders/orders.service';
import { submittedTerms } from '../orders/order-status';
import { DAY_MS } from '../orders/deadline';
import { authorInLinks, authorUrl, platformOf } from '../common/platforms';
import { SubmissionsService } from '../submissions/submissions.service';
import {
  type CountedVideo,
  ViewCounterService,
} from '../submissions/view-counter.service';
import { AnalyticsService } from './analytics.service';
import { ModeratorActionsService } from './moderator-actions.service';
import { parseStatusFilter } from './status-filter';
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
  parseBudgetConfirmed,
  parseCpm,
  parseRejectComment,
  parseLikes,
  parseViews,
  videoFormat,
} from '../orders/order-input';

const PAGE_SIZE = 20;

/** Аккаунт, подключённый раньше стольких дней, модератору уже не подсвечиваем. */
const FRESH_ACCOUNT_DAYS = 7;

/**
 * Чей ролик — модератору: `verified` — посчитан по подключённому аккаунту креатора; `inProfile` —
 * автор есть в соцсетях профиля, но ссылки креатор вписал сам, владение не доказано (иначе
 * вписал бы чужой канал и сдал чужой ролик); `mismatch` — автор известен, но в профиле его нет;
 * `unknown` — площадка автора не отдала. Решает модератор: сдачу и одобрение это не запрещает.
 */
export function videoAuthor(
  stats: CountedVideo | undefined,
  links: string[],
  now = Date.now(),
) {
  if (stats?.ownAccount) {
    // аккаунт подключили недавно — так привязывают чужой аккаунт по пересланной ссылке входа
    const days = stats.connectedAt
      ? Math.floor((now - stats.connectedAt.getTime()) / DAY_MS)
      : null;
    return {
      status: 'verified',
      viaAccount: true,
      name: null,
      url: null,
      connectedDaysAgo:
        days !== null && days < FRESH_ACCOUNT_DAYS ? days : null,
    };
  }
  const a = stats?.author;
  if (!a)
    return {
      status: 'unknown',
      viaAccount: false,
      name: null,
      url: null,
      connectedDaysAgo: null,
    };
  return {
    status: authorInLinks(a, links) ? 'inProfile' : 'mismatch',
    viaAccount: false,
    name: [a.name, a.handle && `@${a.handle}`].filter(Boolean).join(' · '),
    url: authorUrl(a),
    connectedDaysAgo: null,
  };
}

/** За сколько часов до заявки сменили кошелёк, если меньше чем за 48; иначе null. */
export function walletChangedHoursBefore(
  changedAt: Date | null,
  requestedAt: Date,
): number | null {
  if (!changedAt) return null;
  const hours = (requestedAt.getTime() - changedAt.getTime()) / 3_600_000;
  return hours >= 0 && hours < 48 ? Math.floor(hours) : null;
}

/** Версия заказа, которую модератор видел (`version` из GET /api/mod/orders/:id). */
function parseVersion(body: unknown): Date {
  const raw = (body as { version?: unknown } | null)?.version;
  const version = typeof raw === 'string' ? new Date(raw) : null;
  if (!version || !isDbDate(version))
    throw new BadRequestException('Откройте заказ заново');
  return version;
}

/** Начало периода из `days` (1–365); без него — всё время. */
function periodStart(days?: number) {
  if (days === undefined) return undefined;
  if (days < 1 || days > 365)
    throw new BadRequestException('Период — от 1 до 365 дней');
  return new Date(Date.now() - days * DAY_MS);
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
    private readonly actions: ModeratorActionsService,
  ) {}

  /** Обе очереди сразу: заказы и видео на проверке, старые первыми. */
  @Get('queue')
  async queue() {
    const [orders, videos, holds, reviews] = await Promise.all([
      this.ordersService.listPending(),
      this.submissionsService.listPendingModeration(),
      this.submissionsService.listHoldDue(),
      this.submissionsService.listPendingReviews(),
    ]);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        title: o.title,
        budget: fromMinor(o.budgetMinor),
        advertiser: creatorLabel(o.advertiser),
        // ждёт с момента отправки на проверку: после правки — заново
        queuedAt: o.moderationRequestedAt,
        // после правки бюджет выше одобренного — модератору проверить доплату
        budgetRaised: budgetRaised(o),
        // похоже на контакты в обход площадки — модератору пометка в списке
        hasContacts:
          findContacts(o.title, o.description, o.referenceUrl, o.targetUrl)
            .length > 0,
      })),
      videos: videos.map((s) => ({
        id: s.id,
        orderTitle: s.order.title,
        creator: creatorLabel(s.creator),
        submittedAt: s.submittedAt,
      })),
      // холд закончился — проверить публикацию и зафиксировать итог
      holds: holds.map((s) => ({
        id: s.id,
        orderTitle: s.order.title,
        creator: creatorLabel(s.creator),
        decidedAt: s.decidedAt,
      })),
      // отзывы рекламодателей с текстом — до публикации в профиле креатора
      reviews: reviews.map((s) => ({
        submissionId: s.id,
        orderTitle: s.order.title,
        advertiser: creatorLabel(s.order.advertiser),
        creator: creatorLabel(s.creator),
        rating: s.rating,
        review: s.review,
        queuedAt: s.reviewQueuedAt,
        hasContacts: findContacts(s.review).length > 0,
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
    return this.analytics.funnel(periodStart(days));
  }

  /** Что работает — срезы по требованиям заказа и аудитория; период — как у воронки. */
  @Get('what-works')
  whatWorks(
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    return this.analytics.whatWorks(periodStart(days));
  }

  /**
   * Кабинет модератора за последние `days` дней (без параметра — всё время): его цифры, команда
   * (видна всем модераторам — ролей среди них нет) и его последние действия.
   */
  @Get('me')
  async me(
    @Query('days', new ParseIntPipe({ optional: true }))
    days: number | undefined,
    @Req() req: ApiRequest,
  ) {
    const [team, recent] = await Promise.all([
      this.actions.stats(periodStart(days)),
      this.actions.recent(req.user.telegramId),
    ]);
    return {
      moderatorId: req.user.telegramId.toString(),
      team,
      recent: recent.map((a) => ({
        id: a.id,
        type: a.type,
        objectId: a.objectId,
        reportTarget: a.reportTarget,
        amount: a.amountMinor === null ? null : fromMinor(a.amountMinor),
        createdAt: a.createdAt,
      })),
    };
  }

  /** Действия за период файлом CSV в чат с ботом: `scope` — свои (me) или всей команды (team). */
  @Post('me/csv')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async meCsv(@Body() body: unknown, @Req() req: ApiRequest) {
    const { days, scope } = (body ?? {}) as { days?: unknown; scope?: unknown };
    if (days !== undefined && !Number.isInteger(days))
      throw new BadRequestException('Неверный период');
    if (scope !== 'me' && scope !== 'team')
      throw new BadRequestException('Неверная выгрузка');
    const csv = await this.actions.csv(
      periodStart(days as number | undefined),
      scope === 'me' ? req.user.telegramId : undefined,
    );
    const sent = await this.notifications.sendFile(
      req.user.telegramId,
      csv,
      `fixum-moderators-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    if (!sent)
      throw new BadRequestException(
        'Файл не отправился — откройте чат с ботом и нажмите «Старт»',
      );
    return { ok: true };
  }

  /** Все заказы любого статуса — страница, новые первыми. */
  @Get('orders')
  async allOrders(
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) rawPage: number,
    @Query('status') status: unknown,
  ) {
    // огромный номер — смещение больше Int, Prisma упала бы с 500
    const page = Math.min(Math.max(0, rawPage), 100_000);
    const { items, total } = await this.ordersService.listAll(
      page * PAGE_SIZE,
      PAGE_SIZE,
      parseStatusFilter(status),
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
      targetUrl: o.targetUrl,
      ...videoFormat(o),
      budget: fromMinor(o.budgetMinor),
      // одобренный в прошлый раз; выше него — повышение, одобрение только с budgetConfirmed
      approvedBudget: fromMinor(o.approvedBudgetMinor),
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
      contacts: findContacts(
        o.title,
        o.description,
        o.referenceUrl,
        o.targetUrl,
      ),
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
    const version = parseVersion(body);
    const order = await this.ordersService.moderatorApprove(
      id,
      req.user.telegramId,
      version,
      parseCpm(body),
      parseBudgetConfirmed(body),
    );
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.ORDER_APPROVE,
      objectId: id,
      amountMinor: order.budgetMinor,
      waitingSince: version,
    });
    if (order.status === OrderStatus.CLOSED)
      this.notifications.orderBudgetExhausted(order);
    else {
      this.notifications.orderApproved(order);
      // изменённый заказ после повторной проверки — не новый, второй раз не рассылаем
      if (order.firstPublication) this.notifications.newOrderPublished(order);
      // заморозка кончилась — креаторам «в работе»: можно сдавать, слот продлён
      if (order.unfrozen) this.notifications.orderUnfrozen(order);
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
    const version = parseVersion(body);
    const order = await this.ordersService.moderatorReject(
      id,
      req.user.telegramId,
      comment,
      version,
    );
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.ORDER_REJECT,
      objectId: id,
      waitingSince: version,
    });
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
        ? this.viewCounter.fetchViews(
            [{ url: s.videoUrl, creatorId: s.creatorId }],
            { withAuthor: true },
          )
        : new Map<string, CountedVideo>(),
    ]);
    const stats = counted.get(s.videoUrl ?? '');
    // Проверять по условиям, которые креатор видел при сдаче (те же, по которым начислят).
    const terms = { ...s.order, ...submittedTerms(s.order, s) };
    const changedSince =
      !!s.order.editedAt && !!s.submittedAt && s.submittedAt < s.order.editedAt;
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
      autoViews: stats?.views ?? null,
      autoLikes: stats?.likes ?? null,
      author: videoAuthor(stats, s.creator.socialLinks),
      platform: platformOf(s.videoUrl),
      payout: fromMinor(s.payoutMinor),
      decidedAt: s.decidedAt,
      finalizedAt: s.finalizedAt,
      holdDays: HOLD_DAYS,
      order: {
        id: s.order.id,
        title: terms.title,
        description: terms.description,
        ...videoFormat(terms),
        // по ней начислят (videoTerms): сдан до правки — ставка до неё
        cpm: fromMinor(terms.cpmMinor),
        minViews: terms.minViews,
        free: fromMinor(budget.free),
        termsBeforeEdit: changedSince,
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
    const { target, targetId } = decision.group;
    const waitingSince = await this.actions.reportsWaitingSince(
      target,
      targetId,
    );
    const { reporters, closedOrder, bannedOrders } =
      await this.bans.resolveReports(decision, req.user.telegramId);
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: decision.actioned
        ? ModeratorActionType.REPORT_ACTION
        : ModeratorActionType.REPORT_DISMISS,
      objectId: targetId,
      reportTarget: target,
      waitingSince,
    });
    if (closedOrder) this.notifications.orderClosedByModerator(closedOrder);
    for (const order of bannedOrders)
      this.notifications.orderClosedByModerator(order);
    // не ждём: решение уже принято, уведомления — в фоне
    void this.notifications.reportResolved(reporters, decision.actioned);
    return { ok: true };
  }

  @Post('users/:id/ban')
  async ban(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const reason = parseBanReason(
      (body as { reason?: unknown } | null)?.reason,
    );
    for (const order of await this.bans.banUser(id, reason))
      this.notifications.orderClosedByModerator(order);
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.USER_BAN,
      objectId: id,
    });
    return { ok: true };
  }

  @Post('users/:id/unban')
  async unban(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    await this.bans.unban(id);
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.USER_UNBAN,
      objectId: id,
    });
    return { ok: true };
  }

  /** Опубликовать отзыв с проверки в профиле креатора — креатору приходит уведомление об оценке. */
  @Post('reviews/:submissionId/approve')
  async approveReview(
    @Param('submissionId', ParseIdPipe) submissionId: number,
    @Req() req: ApiRequest,
  ) {
    this.notifications.videoRated(
      await this.submissionsService.approveReview(submissionId),
    );
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.REVIEW_APPROVE,
      objectId: submissionId,
    });
    return { ok: true };
  }

  /** Удалить отзыв креатору (оскорбления и т.п.) или отклонить с проверки; приёмка видео остаётся. */
  @Delete('reviews/:submissionId')
  async removeReview(
    @Param('submissionId', ParseIdPipe) submissionId: number,
    @Req() req: ApiRequest,
  ) {
    await this.submissionsService.removeReview(submissionId);
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.REVIEW_REMOVE,
      objectId: submissionId,
    });
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
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.VIDEO_APPROVE,
      objectId: id,
      amountMinor: submission.payoutMinor,
      waitingSince: submission.submittedAt,
    });
    this.notifications.videoApprovedByModerator(submission);
    if (closed) this.notifications.orderBudgetExhausted(closed);
    return { ok: true };
  }

  /** Итог холда: публикация на месте, просмотры — для отчёта; деньги можно вывести. */
  @Post('videos/:id/finalize')
  async finalizeVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body('views') views: unknown,
    @Body('likes') likes: unknown,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.finalizeViews(
      id,
      parseViews(views),
      parseLikes(likes),
    );
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.HOLD_FINALIZE,
      objectId: id,
      amountMinor: submission.payoutMinor,
      // ждал — с конца холда, а не с одобрения
      waitingSince: submission.decidedAt
        ? new Date(submission.decidedAt.getTime() + HOLD_DAYS * DAY_MS)
        : null,
    });
    this.notifications.viewsFinalized(submission);
    return { ok: true };
  }

  /** При итоге публикации нет — начисление из холда отменяется, креатору — уведомление. */
  @Post('videos/:id/deleted')
  async publicationDeleted(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.publicationDeleted(
      id,
      req.user.telegramId,
    );
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.PUBLICATION_DELETED,
      objectId: id,
    });
    this.notifications.publicationDeleted(submission);
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
      // забаненному (например, за накрутку) модератор, скорее всего, не переведёт — решает сам
      banned: p.creator.bannedAt
        ? { at: p.creator.bannedAt, reason: p.creator.banReason }
        : null,
      // кошелёк сменили незадолго до заявки — так выводят деньги с угнанного аккаунта
      walletChangedHoursBefore: walletChangedHoursBefore(
        p.creator.walletChangedAt,
        p.createdAt,
      ),
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
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.PAYOUT_PAID,
      objectId: id,
      amountMinor: payout.amountMinor,
      waitingSince: payout.createdAt,
    });
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
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.PAYOUT_REJECT,
      objectId: id,
      amountMinor: payout.amountMinor,
      waitingSince: payout.createdAt,
    });
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
    await this.actions.log({
      moderatorId: req.user.telegramId,
      type: ModeratorActionType.VIDEO_REJECT,
      objectId: id,
      waitingSince: submission.submittedAt,
    });
    this.notifications.videoRejectedByModerator(submission, comment);
    return { ok: true };
  }
}
