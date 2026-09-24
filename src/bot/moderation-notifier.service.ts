import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, Submission, User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Markup, Telegraf } from 'telegraf';
import type { BotContext } from './interfaces/bot-context.interface';
import { styled } from './utils/button.util';
import { creatorLabel, escapeHtml, html } from './utils/format';
import { parseModeratorIds } from './utils/moderator.util';

/**
 * Уведомления модераторам в чат бота. Отдельный сервис, потому что видео присылают и из бота
 * (сцена submit-video), и из Mini App (API) — модераторы должны узнать о нём в обоих случаях.
 */
@Injectable()
export class ModerationNotifier {
  private readonly moderatorIds: string[];

  constructor(
    @InjectBot() private readonly bot: Telegraf<BotContext>,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    );
  }

  async videoSubmitted(
    submission: Submission & { order: Order; creator: User },
  ) {
    const text = [
      '🆕 <b>Новый отклик на модерацию</b>',
      '',
      `Заказ #${submission.order.id}: <b>${escapeHtml(submission.order.title)}</b>`,
      `Креатор: ${escapeHtml(creatorLabel(submission.creator))}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    const kb = html(
      Markup.inlineKeyboard([
        styled(
          Markup.button.callback('✅ Одобрить', `mod:approve:${submission.id}`),
          'success',
        ),
        styled(
          Markup.button.callback('❌ Отклонить', `mod:reject:${submission.id}`),
          'danger',
        ),
      ]),
    );
    for (const modId of this.moderatorIds) {
      try {
        await this.bot.telegram.sendMessage(modId, text, kb);
      } catch {
        // модератор ещё не запускал бота — пропускаем
      }
    }
  }
}
