import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { InitDataGuard } from './init-data.guard';
import { OrdersController } from './orders.controller';

/** HTTP API для Telegram Mini App — тонкий слой над теми же сервисами, что и бот. */
@Module({
  imports: [UsersModule, OrdersModule, SubmissionsModule],
  controllers: [OrdersController],
  providers: [InitDataGuard],
})
export class ApiModule {}
