import { Module } from '@nestjs/common';
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
import { OrdersController } from './orders.controller';
import { SubmissionsController } from './submissions.controller';

/** HTTP API для Telegram Mini App — тонкий слой над сервисами; плюс фоновые задачи по срокам и очереди модерации. */
@Module({
  imports: [UsersModule, OrdersModule, SubmissionsModule, BotModule],
  controllers: [
    OrdersController,
    SubmissionsController,
    MyOrdersController,
    MeController,
    ModerationController,
  ],
  providers: [InitDataGuard, ModeratorGuard, ScheduledJob],
})
export class ApiModule {}
