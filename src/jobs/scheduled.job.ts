import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsService } from '../telegram/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { ViewCounterService } from '../submissions/view-counter.service';
import { PayoutsService } from '../payouts/payouts.service';

const INTERVAL_MS = 5 * 60 * 1000;
/** Сколько заказ или видео может ждать модератора, прежде чем напомним. И не чаще, чем раз в столько же. */
const STALE_HOURS = 12;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/**
 * Фоновые задачи раз в 5 минут: закрыть заказы с истёкшим сроком, напомнить креаторам о близком
 * сроке, сжечь просроченные слоты и напомнить о них, напомнить модераторам о застрявшей очереди.
 * ponytail: setInterval в одном процессе — хватает, пока инстанс один. Станет несколько —
 * cron (@nestjs/schedule) на одном из них или advisory lock в Postgres, иначе уведомления задвоятся.
 */
@Injectable()
export class ScheduledJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJob.name);
  private timer?: NodeJS.Timeout;
  // ponytail: в памяти — после рестарта модераторы могут получить напоминание раньше, чем через 12 ч.
  private lastQueueReminder = 0;
  /** Прошлый проход ещё идёт (медленная база, сотни уведомлений) — следующий пропускаем. */
  private running = false;

  constructor(
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
      await this.runTasks();
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
   * Итог добора по роликам, чьи просмотры отдаёт API площадки (YouTube), — без модератора.
   * API не ответило — ролик остаётся в очереди «Итоги», итог введёт модератор.
   */
  private async finalizeAutomatic() {
    const due = (await this.submissionsService.listTopupDue()).filter((s) =>
      this.viewCounter.isAutomatic(s.videoUrl),
    );
    if (!due.length) return;
    const counted = await this.viewCounter.fetchViews(
      due.map((s) => s.videoUrl!),
    );
    for (const s of due) {
      const stats = counted.get(s.videoUrl!);
      if (!stats) continue;
      try {
        // просмотры не уменьшаем: начисленное за них уже не вернуть
        const { submission, extraMinor, closed } =
          await this.submissionsService.finalizeViews(
            s.id,
            Math.max(stats.views, s.views ?? 0),
            stats.likes,
          );
        this.notifications.viewsFinalized(submission, extraMinor);
        if (closed) this.notifications.orderBudgetExhausted(closed);
      } catch (err) {
        // модератор успел зафиксировать итог сам — остальные ролики это не останавливает
        this.logger.warn(err);
      }
    }
  }

  private async remindModerators() {
    if (Date.now() - this.lastQueueReminder < STALE_MS) return;
    const staleBefore = new Date(Date.now() - STALE_MS);
    const [
      staleOrders,
      { videos: staleVideos, topups: staleTopups },
      stalePayouts,
    ] = await Promise.all([
      this.ordersService.countPendingBefore(staleBefore),
      this.submissionsService.countStaleBefore(staleBefore),
      this.payouts.countRequestedBefore(staleBefore),
    ]);
    if (!staleOrders && !staleVideos && !staleTopups && !stalePayouts) return;
    this.notifications.moderationQueueStale(
      {
        orders: staleOrders,
        videos: staleVideos,
        topups: staleTopups,
        payouts: stalePayouts,
      },
      STALE_HOURS,
    );
    this.lastQueueReminder = Date.now();
  }
}
