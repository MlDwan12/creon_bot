import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BotModule } from '../bot/bot.module';
import { OrdersModule } from '../orders/orders.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { AnalyticsService } from './analytics.service';
import { BansService } from './bans.service';
import { HealthController } from './health.controller';
import { InitDataGuard } from './init-data.guard';
import { MeController } from './me.controller';
import { ModerationController } from './moderation.controller';
import { ModeratorGuard } from './moderator.guard';
import { MyOrdersController } from './my-orders.controller';
import { ScheduledJob } from './scheduled.job';
import { UserThrottlerGuard } from './user-throttler.guard';
import { OrdersController } from './orders.controller';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SupportController } from './support.controller';
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
    HealthController,
    OrdersController,
    SubmissionsController,
    MyOrdersController,
    MeController,
    ModerationController,
    ProfilesController,
    ReportsController,
    SupportController,
  ],
  providers: [
    AnalyticsService,
    BansService,
    ProfilesService,
    ReportsService,
    InitDataGuard,
    ModeratorGuard,
    UserThrottlerGuard,
    ScheduledJob,
  ],
})
export class ApiModule {}
