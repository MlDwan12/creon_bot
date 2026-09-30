import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReportsModule } from '../reports/reports.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalyticsService } from './analytics.service';
import { ModerationController } from './moderation.controller';

@Module({
  imports: [
    AuthModule,
    TelegramModule,
    OrdersModule,
    SubmissionsModule,
    PayoutsModule,
    ReportsModule,
  ],
  controllers: [ModerationController],
  providers: [AnalyticsService],
})
export class ModerationModule {}
