import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsService } from '../bot/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';

const INTERVAL_MS = 5 * 60 * 1000;
/** Сколько заказ или видео может ждать модератора, прежде чем напомним. И не чаще, чем раз в столько же. */
const STALE_HOURS = 12;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/**
 * Фоновые задачи раз в 5 минут: закрыть заказы с истёкшим сроком, напомнить креаторам о близком
 * сроке, напомнить модераторам о застрявшей очереди.
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

  private async remindModerators() {
    if (Date.now() - this.lastQueueReminder < STALE_MS) return;
    const staleBefore = Date.now() - STALE_MS;
    const [orders, videos] = await Promise.all([
      this.ordersService.listPending(),
      this.submissionsService.listPendingModeration(),
    ]);
    const staleOrders = orders.filter(
      (o) => o.moderationRequestedAt.getTime() < staleBefore,
    ).length;
    const staleVideos = videos.filter(
      (s) => s.submittedAt && s.submittedAt.getTime() < staleBefore,
    ).length;
    if (!staleOrders && !staleVideos) return;
    this.notifications.moderationQueueStale(
      staleOrders,
      staleVideos,
      STALE_HOURS,
    );
    this.lastQueueReminder = Date.now();
  }
}
