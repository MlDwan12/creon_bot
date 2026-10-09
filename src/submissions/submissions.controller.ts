import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NotificationsService } from '../telegram/notifications.service';
import { SubmissionsService } from './submissions.service';
import { parseVideoSubmission } from './video-input';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { toMySubmissions } from './my-submissions';
import { parseFeedback } from '../profiles/profile-input';

@Controller('api/submissions')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class SubmissionsController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Отклики текущего пользователя как креатора. */
  @Get()
  async listMine(@Req() req: ApiRequest) {
    return toMySubmissions(
      await this.submissionsService.listByCreator(req.user.id),
    );
  }

  /** Ссылка на опубликованный ролик и его просмотры; модераторам уведомление. */
  @Post(':id/video')
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  async submitVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.submitVideo(
      id,
      req.user.id,
      parseVideoSubmission(body),
    );
    this.notifications.videoSubmitted(submission);
    return { ok: true };
  }

  /** Рекламодатель по желанию оценивает одобренный ролик (rate проверяет, что заказ его). */
  @Post(':id/rate')
  async rate(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.rate(
      id,
      req.user.id,
      parseFeedback(body),
    );
    this.notifications.videoRated(submission);
    return { ok: true };
  }
}
