import { Module } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { ViewCounterService } from './view-counter.service';

@Module({
  providers: [SubmissionsService, ViewCounterService],
  exports: [SubmissionsService, ViewCounterService],
})
export class SubmissionsModule {}
