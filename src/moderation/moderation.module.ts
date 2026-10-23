import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReportsModule } from '../reports/reports.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalyticsService } from './analytics.service';
import { BansService } from './bans.service';
import { ModerationController } from './moderation.controller';
import { ModeratorActionsService } from './moderator-actions.service';
import { ModUsersService } from './mod-users.service';

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
  providers: [
    AnalyticsService,
    BansService,
    ModeratorActionsService,
    ModUsersService,
  ],
})
export class ModerationModule {}
