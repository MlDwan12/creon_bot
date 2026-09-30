import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ScheduledJob } from './scheduled.job';

/** Фоновые задачи по срокам и очереди модерации. */
@Module({
  imports: [TelegramModule, OrdersModule, SubmissionsModule, PayoutsModule],
  providers: [ScheduledJob],
})
export class JobsModule {}
