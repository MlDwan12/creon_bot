import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { TrackController, VideoLinkController } from './track.controller';
import { ViewCounterService } from './view-counter.service';

@Module({
  imports: [AuthModule, TelegramModule, AccountsModule],
  controllers: [SubmissionsController, TrackController, VideoLinkController],
  providers: [SubmissionsService, ViewCounterService],
  exports: [SubmissionsService, ViewCounterService],
})
export class SubmissionsModule {}
