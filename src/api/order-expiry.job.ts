import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsService } from '../bot/notifications.service';
import { OrdersService } from '../orders/orders.service';

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Закрывает заказы с истёкшим сроком и сообщает об этом рекламодателю и креаторам с откликом «в работе».
 * ponytail: setInterval в одном процессе — хватает, пока инстанс один. Станет несколько —
 * cron (@nestjs/schedule) на одном из них или advisory lock в Postgres, иначе уведомления задвоятся.
 */
@Injectable()
export class OrderExpiryJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly ordersService: OrdersService,
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
    try {
      for (const { id } of await this.ordersService.listOverdue()) {
        // expire вернёт null, если заказ успели продлить
        const order = await this.ordersService.expire(id);
        if (order) await this.notifications.orderExpired(order);
      }
    } catch (err) {
      this.logger.error(err);
    }
  }
}
