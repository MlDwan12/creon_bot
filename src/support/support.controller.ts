import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupportService } from './support.service';
import { isDbId, isMeaningfulText } from '../common/validation';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';

const MAX_SUPPORT_MESSAGE = 1000;

/** Написать менеджеру прямо из мини-аппа, не уходя в чат с ботом; ответ придёт в чат с ботом. */
@Controller('api/support')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async send(
    @Body() body: { text?: unknown; orderId?: unknown; topic?: unknown },
    @Req() req: ApiRequest,
  ) {
    const value = body?.text;
    if (!this.support.chatId)
      throw new NotFoundException(tr('errors.supportOff'));
    const text = typeof value === 'string' ? value.trim() : '';
    if (!isMeaningfulText(text))
      throw new BadRequestException(tr('errors.supportEmpty'));
    if (text.length > MAX_SUPPORT_MESSAGE)
      throw new BadRequestException(
        tr('errors.supportTooLong', { max: MAX_SUPPORT_MESSAGE }),
      );
    const allowed = this.support.allowMessage(Number(req.user.telegramId));
    if (allowed !== 'ok')
      throw new HttpException(
        tr(allowed === 'flood' ? 'errors.supportFlood' : 'errors.supportBusy'),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    // тема — только заказ или выплата: свой текст темы клиент не передаёт (подписывает сервер)
    const orderId = isDbId(body.orderId) ? body.orderId : null;
    const payout = body.topic === 'payout';
    await this.support.fromApp(req.user, text, { orderId, payout });
    return { ok: true };
  }
}
