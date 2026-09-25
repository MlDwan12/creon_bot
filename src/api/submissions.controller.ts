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
import { SupportService } from '../bot/support.service';
import { creatorLabel, escapeHtml, formatPrice } from '../bot/utils/format';
import { kopecksToRubles } from '../common/money';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../common/validation';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { toMySubmissions } from './my-submissions';
import { parseRejectComment } from './order-input';
import { assertNoContacts, parseFeedback } from './profile-input';

@Controller('api/submissions')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class SubmissionsController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
    private readonly support: SupportService,
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
    @Param('id', ParseIdPipe) id: number,
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
    this.notifications.videoSubmitted(submission);
    return { ok: true };
  }

  /** Рекламодатель принимает видео с оценкой (advertiserApprove проверяет, что заказ его). */
  @Post(':id/accept')
  async accept(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.advertiserApprove(
      id,
      req.user.id,
      parseFeedback(body),
    );
    this.notifications.videoAccepted(submission);
    // оплата пока вне бота: менеджеру — кому и сколько перевести
    const price = submission.order.priceKopecks;
    await this.support.paymentDue(
      [
        '💸 <b>К оплате</b>',
        `Заказ #${submission.order.id}: ${escapeHtml(submission.order.title)}`,
        `Креатор: ${escapeHtml(creatorLabel(submission.creator))} (#u${submission.creator.telegramId})`,
        `Рекламодатель: ${escapeHtml(creatorLabel(req.user))} (#u${req.user.telegramId})`,
        `Цена: ${formatPrice(price === null ? null : kopecksToRubles(price))}`,
        `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
      ].join('\n'),
    );
    return { ok: true };
  }

  /** Рекламодатель отклоняет видео с причиной — креатору уходит уведомление. */
  @Post(':id/reject')
  async reject(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    assertNoContacts(comment);
    const submission = await this.submissionsService.advertiserReject(
      id,
      req.user.id,
      comment,
    );
    this.notifications.videoRejectedByAdvertiser(submission, comment);
    return { ok: true };
  }
}
