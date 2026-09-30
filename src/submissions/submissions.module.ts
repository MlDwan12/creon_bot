import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ViewCounterService } from './view-counter.service';

@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, ViewCounterService],
  exports: [SubmissionsService, ViewCounterService],
})
export class SubmissionsModule {}
