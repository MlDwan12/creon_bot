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
import { OrderExpiryJob } from './order-expiry.job';
import { OrdersController } from './orders.controller';
import { SubmissionsController } from './submissions.controller';

/** HTTP API для Telegram Mini App — тонкий слой над сервисами; плюс автозакрытие заказов по сроку. */
@Module({
  imports: [UsersModule, OrdersModule, SubmissionsModule, BotModule],
  controllers: [
    OrdersController,
    SubmissionsController,
    MyOrdersController,
    MeController,
    ModerationController,
  ],
  providers: [InitDataGuard, ModeratorGuard, OrderExpiryJob],
})
export class ApiModule {}
