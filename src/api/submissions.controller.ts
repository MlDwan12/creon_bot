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
import { ModerationNotifier } from '../bot/moderation-notifier.service';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../bot/utils/validation';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { toMySubmissions } from './my-submissions';

@Controller('api/submissions')
@UseGuards(InitDataGuard)
export class SubmissionsController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly notifier: ModerationNotifier,
  ) {}

  /** Отклики текущего пользователя как креатора. */
  @Get()
  async listMine(@Req() req: ApiRequest) {
    return toMySubmissions(
      await this.submissionsService.listByCreator(req.user.id),
    );
  }

  /** Ссылка на готовое видео — как в сцене бота: те же проверки, тот же сервис, то же уведомление модераторам. */
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
    await this.notifier.videoSubmitted(submission);
    return { ok: true };
  }
}
