import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MyOrdersController } from './my-orders.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ShareController } from './share.controller';

@Module({
  imports: [AuthModule, TelegramModule, SubmissionsModule],
  controllers: [OrdersController, MyOrdersController, ShareController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
