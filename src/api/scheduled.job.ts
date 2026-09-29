import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsService } from '../bot/notifications.service';
import { VIEWS_TOPUP_DAYS } from '../orders/budget';
import { DAY_MS } from '../orders/deadline';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';

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

  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    void this.run();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async run() {
    // Задачи независимы: сбой одной не должен останавливать остальные.
    for (const task of [
      () => this.expireOverdue(),
      () => this.remindDeadlines(),
      () => this.expireSlots(),
      () => this.remindSlots(),
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

  private async remindModerators() {
    if (Date.now() - this.lastQueueReminder < STALE_MS) return;
    const staleBefore = Date.now() - STALE_MS;
    const [orders, videos, topups] = await Promise.all([
      this.ordersService.listPending(),
      this.submissionsService.listPendingModeration(),
      this.submissionsService.listTopupDue(),
    ]);
    const staleOrders = orders.filter(
      (o) => o.moderationRequestedAt.getTime() < staleBefore,
    ).length;
    const staleVideos = videos.filter(
      (s) => s.submittedAt && s.submittedAt.getTime() < staleBefore,
    ).length;
    // итог добора ждёт с конца добора — тоже не дольше STALE_HOURS
    const staleTopups = topups.filter(
      (s) =>
        s.decidedAt &&
        s.decidedAt.getTime() + VIEWS_TOPUP_DAYS * DAY_MS < staleBefore,
    ).length;
    if (!staleOrders && !staleVideos && !staleTopups) return;
    this.notifications.moderationQueueStale(
      staleOrders,
      staleVideos,
      staleTopups,
      STALE_HOURS,
    );
    this.lastQueueReminder = Date.now();
  }
}
