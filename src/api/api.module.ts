import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { OrdersModule } from '../orders/orders.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { InitDataGuard } from './init-data.guard';
import { MyOrdersController } from './my-orders.controller';
import { OrdersController } from './orders.controller';
import { SubmissionsController } from './submissions.controller';

/** HTTP API для Telegram Mini App — тонкий слой над теми же сервисами, что и бот. */
@Module({
  imports: [UsersModule, OrdersModule, SubmissionsModule, BotModule],
  controllers: [OrdersController, SubmissionsController, MyOrdersController],
  providers: [InitDataGuard],
})
export class ApiModule {}
