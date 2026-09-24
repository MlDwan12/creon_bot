import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BotModule } from '../bot/bot.module';
import { OrdersModule } from '../orders/orders.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { InitDataGuard } from './init-data.guard';
import { MeController } from './me.controller';
import { ModerationController } from './moderation.controller';
import { ModeratorGuard } from './moderator.guard';
import { MyOrdersController } from './my-orders.controller';
import { ScheduledJob } from './scheduled.job';
import { UserThrottlerGuard } from './user-throttler.guard';
import { OrdersController } from './orders.controller';
import { SubmissionsController } from './submissions.controller';

/** HTTP API для Telegram Mini App — тонкий слой над сервисами; плюс фоновые задачи по срокам и очереди модерации. */
@Module({
  imports: [
    UsersModule,
    OrdersModule,
    SubmissionsModule,
    BotModule,
    // Общий лимит на пользователя; у создания заказа и отклика — свои, построже (@Throttle).
    // ponytail: счётчики в памяти процесса — пока инстанс один; станет несколько — хранилище в Redis.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      errorMessage:
        'Слишком много запросов — подождите минуту и попробуйте снова',
    }),
  ],
  controllers: [
    OrdersController,
    SubmissionsController,
    MyOrdersController,
    MeController,
    ModerationController,
  ],
  providers: [InitDataGuard, ModeratorGuard, UserThrottlerGuard, ScheduledJob],
})
export class ApiModule {}
