import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MyOrdersController } from './my-orders.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, TelegramModule, SubmissionsModule],
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
