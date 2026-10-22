import { userLang } from '../i18n/i18n';
import { withLang } from '../i18n/request-lang';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { acquireLease } from './job-lease';
import { NotificationsService } from '../telegram/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { ViewCounterService } from '../submissions/view-counter.service';
import { PayoutsService } from '../payouts/payouts.service';

const INTERVAL_MS = 5 * 60 * 1000;
/** Аренда — на три прохода: держатель упал — задачи заберёт другая копия не позже чем через 15 мин. */
const LEASE_MS = 3 * INTERVAL_MS;
/** Сколько заказ или видео может ждать модератора, прежде чем напомним. И не чаще, чем раз в столько же. */
const STALE_HOURS = 12;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/**
 * Фоновые задачи раз в 5 минут: закрыть заказы с истёкшим сроком, напомнить креаторам о близком
 * сроке, сжечь просроченные слоты и напомнить о них, напомнить модераторам о застрявшей очереди,
 * прислать рекламодателю совет по заказу.
 * Копий бота может быть несколько — задачи выполняет одна, держатель аренды (JobLease), иначе
 * уведомления задвоились бы. Пока он жив, аренда за ним: и lastQueueReminder в памяти не теряется.
 */
@Injectable()
export class ScheduledJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJob.name);
  private timer?: NodeJS.Timeout;
  // ponytail: в памяти — после рестарта модераторы могут получить напоминание раньше, чем через 12 ч.
  private lastQueueReminder = 0;
  /** Прошлый проход ещё идёт (медленная база, сотни уведомлений) — следующий пропускаем. */
  private running = false;
  /** Этот процесс в аренде задач. */
  private readonly holder = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
    private readonly payouts: PayoutsService,
    private readonly viewCounter: ViewCounterService,
  ) {}

  onApplicationBootstrap() {
    void this.run();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      if (await acquireLease(this.prisma, 'scheduled', this.holder, LEASE_MS))
        await this.runTasks();
    } catch (err) {
      // база недоступна — попробуем в следующий проход
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }

  private async runTasks() {
    // Задачи независимы: сбой одной не должен останавливать остальные.
    for (const task of [
      () => this.expireOverdue(),
      () => this.remindDeadlines(),
      () => this.expireSlots(),
      () => this.remindSlots(),
      () => this.finalizeAutomatic(),
      () => this.remindModerators(),
      () => this.sendInsights(),
    ]) {
      try {
        await task();
      } catch (err) {
        this.logger.error(err);
      }
    }
  }

  private async expireOverdue() {
    for (const { id } of await this.ordersService.listOverdue()) {
      // expire вернёт null, если заказ успели продлить
      const order = await this.ordersService.expire(id);
      if (order) this.notifications.orderExpired(order);
    }
  }

  private async remindDeadlines() {
    for (const { id } of await this.ordersService.listDeadlineSoon()) {
      const order = await this.ordersService.markDeadlineReminded(id);
      if (order) this.notifications.deadlineSoon(order);
    }
  }

  private async expireSlots() {
    for (const { id } of await this.submissionsService.listSlotOverdue()) {
      const submission = await this.submissionsService.expireSlot(id);
      if (submission) this.notifications.slotExpired(submission);
    }
  }

  private async remindSlots() {
    for (const { id } of await this.submissionsService.listSlotEndingSoon()) {
      const submission = await this.submissionsService.markSlotReminded(id);
      if (submission) this.notifications.slotEndingSoon(submission);
    }
  }

  /**
   * Итог холда по роликам, чьи просмотры отдаёт API площадки (YouTube, X, а TikTok и VK — если
   * креатор подключил аккаунт), — без модератора.
   * API не ответило — ролик остаётся в очереди «Итоги», итог введёт модератор. Ролики заблокированного
   * креатора — тоже модератору: бан бывает за накрутку, деньги к выводу выпускать решает человек.
   */
  private async finalizeAutomatic() {
    const due = (await this.submissionsService.listHoldDue()).filter(
      (s) => !s.creator.bannedAt && this.viewCounter.isAutomatic(s.videoUrl),
    );
    if (!due.length) return;
    const counted = await this.viewCounter.fetchViews(
      due.map((s) => ({ url: s.videoUrl!, creatorId: s.creatorId })),
    );
    for (const s of due) {
      const stats = counted.get(s.videoUrl!);
      if (!stats) continue;
      try {
        // в отчёте просмотры не уменьшаются: API бывает отдаёт меньше, чем видел модератор
        const submission = await this.submissionsService.finalizeViews(
          s.id,
          Math.max(stats.views, s.views ?? 0),
          stats.likes,
        );
        this.notifications.viewsFinalized(submission);
      } catch (err) {
        // модератор успел зафиксировать итог сам — остальные ролики это не останавливает
        this.logger.warn(err);
      }
    }
  }

  /**
   * Первый появившийся совет по заказу — рекламодателю сообщением, один раз на заказ.
   * ponytail: отчёт по каждому открытому заказу раз в 5 минут — хватит на сотни заказов;
   * станет тяжело — проверять только заказы, где что-то изменилось.
   */
  private async sendInsights() {
    for (const order of await this.ordersService.listInsightsPending()) {
      // совет — на языке рекламодателя: запроса здесь нет, язык задаём явно
      const [first] = (
        await withLang(userLang(order.advertiser), () =>
          this.ordersService.report(order),
        )
      ).insights;
      if (first && (await this.ordersService.markInsightsSent(order.id)))
        this.notifications.orderInsight(order, first.text);
    }
  }

  private async remindModerators() {
    if (Date.now() - this.lastQueueReminder < STALE_MS) return;
    const staleBefore = new Date(Date.now() - STALE_MS);
    const [
      staleOrders,
      { videos: staleVideos, holds: staleHolds, reviews: staleReviews },
      stalePayouts,
    ] = await Promise.all([
      this.ordersService.countPendingBefore(staleBefore),
      this.submissionsService.countStaleBefore(staleBefore),
      this.payouts.countRequestedBefore(staleBefore),
    ]);
    if (
      !staleOrders &&
      !staleVideos &&
      !staleHolds &&
      !stalePayouts &&
      !staleReviews
    )
      return;
    this.notifications.moderationQueueStale(
      {
        orders: staleOrders,
        videos: staleVideos,
        holds: staleHolds,
        payouts: stalePayouts,
        reviews: staleReviews,
      },
      STALE_HOURS,
    );
    this.lastQueueReminder = Date.now();
  }
}
