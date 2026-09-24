import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from '../bot/notifications.service';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../common/validation';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { toMySubmissions } from './my-submissions';
import { parseRejectComment } from './order-input';

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

  /** Ссылка на готовое видео; модераторам уведомление. */
  @Post(':id/video')
  async submitVideo(
    @Param('id', ParseIntPipe) id: number,
    @Body('videoUrl') videoUrl: unknown,
    @Req() req: ApiRequest,
  ) {
    const url = typeof videoUrl === 'string' ? videoUrl.trim() : '';
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
    // attachVideo сам проверяет, что отклик ваш и ещё «в работе».
    const submission = await this.submissionsService.attachVideo(
      id,
      req.user.id,
      url,
    );
    await this.notifications.videoSubmitted(submission);
    return { ok: true };
  }

  /** Рекламодатель принимает видео (advertiserApprove проверяет, что заказ его). */
  @Post(':id/accept')
  async accept(@Param('id', ParseIntPipe) id: number, @Req() req: ApiRequest) {
    const submission = await this.submissionsService.advertiserApprove(
      id,
      req.user.id,
    );
    await this.notifications.videoAccepted(submission);
    return { ok: true };
  }

  /** Рекламодатель отклоняет видео с причиной — креатору уходит уведомление. */
  @Post(':id/reject')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    const submission = await this.submissionsService.advertiserReject(
      id,
      req.user.id,
      comment,
    );
    await this.notifications.videoRejectedByAdvertiser(submission, comment);
    return { ok: true };
  }
}
