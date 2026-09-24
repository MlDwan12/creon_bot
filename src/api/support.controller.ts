import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupportService } from '../bot/support.service';
import { isMeaningfulText } from '../common/validation';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';

const MAX_SUPPORT_MESSAGE = 1000;

/** Написать менеджеру прямо из мини-аппа, не уходя в чат с ботом; ответ придёт в чат с ботом. */
@Controller('api/support')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async send(@Body('text') value: unknown, @Req() req: ApiRequest) {
    if (!this.support.chatId)
      throw new NotFoundException('Поддержка не настроена');
    const text = typeof value === 'string' ? value.trim() : '';
    if (!isMeaningfulText(text))
      throw new BadRequestException('Напишите вопрос');
    if (text.length > MAX_SUPPORT_MESSAGE)
      throw new BadRequestException(
        `Сообщение длиннее ${MAX_SUPPORT_MESSAGE} символов`,
      );
    await this.support.fromApp(req.user, text);
    return { ok: true };
  }
}
