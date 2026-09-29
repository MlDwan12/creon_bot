import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';
import { NotificationsService } from '../bot/notifications.service';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../common/validation';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { toMySubmissions } from './my-submissions';
import { parseViews } from './order-input';
import { parseFeedback } from './profile-input';

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
  async submitVideo(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const b = (body ?? {}) as Record<string, unknown>;
    const url = typeof b.videoUrl === 'string' ? b.videoUrl.trim() : '';
    if (!VIDEO_URL_RE.test(url)) {
      throw new BadRequestException(
        'Похоже, это не ссылка: она должна начинаться с http:// или https://',
      );
    }
    if (url.length > MAX_URL_LENGTH) {
      throw new BadRequestException(
        `Ссылка слишком длинная (максимум ${MAX_URL_LENGTH} символов)`,
      );
    }
    // attachVideo сам проверяет, что отклик ваш и ещё «в работе», порог и бюджет.
    const { submission, closed } = await this.submissionsService.attachVideo(
      id,
      req.user.id,
      url,
      parseViews(b.views),
    );
    this.notifications.videoSubmitted(submission);
    if (closed) this.notifications.orderBudgetExhausted(closed);
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
