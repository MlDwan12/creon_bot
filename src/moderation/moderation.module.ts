import { Module } from '@nestjs/common';
import { AdvertisersModule } from '../advertisers/advertisers.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ReportsModule } from '../reports/reports.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalyticsService } from './analytics.service';
import { BansService } from './bans.service';
import { ErasureService } from './erasure.service';
import { ModerationController } from './moderation.controller';
import { ModeratorActionsService } from './moderator-actions.service';
import { ModUsersService } from './mod-users.service';

@Module({
  imports: [
    AdvertisersModule,
    AuthModule,
    TelegramModule,
    OrdersModule,
    SubmissionsModule,
    PayoutsModule,
    ReportsModule,
    ProfilesModule,
  ],
  controllers: [ModerationController],
  providers: [
    AnalyticsService,
    BansService,
    ErasureService,
    ModeratorActionsService,
    ModUsersService,
  ],
})
export class ModerationModule {}
