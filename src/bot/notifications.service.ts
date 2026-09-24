import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, Submission, User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Markup, Telegraf } from 'telegraf';
import type { BotContext } from './interfaces/bot-context.interface';
import { styled } from './utils/button.util';
import {
  creatorLabel,
  escapeHtml,
  formatDeadline,
  html,
  orderCategoryLabel,
} from './utils/format';
import { parseModeratorIds } from './utils/moderator.util';

type SubmissionWithParties = Submission & { order: Order; creator: User };

/**
 * Все уведомления в чат бота. Отдельный сервис, потому что одни и те же события происходят
 * и из бота, и из Mini App (API) — люди должны получить одинаковое сообщение в обоих случаях.
 * Каждая отправка глушит ошибку: получатель мог заблокировать бота или ещё не запускал его.
 */
@Injectable()
export class NotificationsService {
  private readonly moderatorIds: string[];

  constructor(
    @InjectBot() private readonly bot: Telegraf<BotContext>,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    );
  }

  /** Модераторам: новый заказ ждёт проверки. */
  async orderCreated(order: Order & { advertiser: User }) {
    const text = [
      '🆕 <b>Новый заказ на проверку</b>',
      '',
      `#${order.id}: <b>${escapeHtml(order.title)}</b>`,
      escapeHtml(order.description),
      orderCategoryLabel(order.category),
      order.price ? `💰 ${escapeHtml(order.price)}` : '💰 цена не указана',
      order.deadline ? `⏰ Дедлайн: ${formatDeadline(order.deadline)}` : '',
      `Рекламодатель: ${escapeHtml(creatorLabel(order.advertiser))}`,
    ]
      .filter(Boolean)
      .join('\n');
    await this.toModerators(
      text,
      `order:approve:${order.id}`,
      `order:reject:${order.id}`,
    );
  }

  /** Модераторам: креатор прислал видео. */
  async videoSubmitted(submission: SubmissionWithParties) {
    const text = [
      '🆕 <b>Новый отклик на модерацию</b>',
      '',
      `Заказ #${submission.order.id}: <b>${escapeHtml(submission.order.title)}</b>`,
      `Креатор: ${escapeHtml(creatorLabel(submission.creator))}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    await this.toModerators(
      text,
      `mod:approve:${submission.id}`,
      `mod:reject:${submission.id}`,
    );
  }

  /** Креаторам с откликами на заказ: рекламодатель его закрыл. */
  async orderClosed(order: OrderWithCreators) {
    await this.toCreators(
      order,
      `🔒 Заказ «${escapeHtml(order.title)}» закрыт рекламодателем. Новые отклики по нему больше не принимаются.`,
    );
  }

  /** Креаторам с откликами на заказ: рекламодатель его удалил. */
  async orderRemoved(order: OrderWithCreators) {
    await this.toCreators(
      order,
      `🗑 Заказ «${escapeHtml(order.title)}» удалён рекламодателем. Отклик по нему больше не актуален.`,
    );
  }

  /** Креатору: рекламодатель принял видео. */
  async videoAccepted(submission: SubmissionWithParties) {
    await this.send(
      submission.creator.telegramId,
      `🎉 Рекламодатель подтвердил ваше видео по заказу «${submission.order.title}»!`,
    );
  }

  /** Креатору: рекламодатель отклонил видео. */
  async videoRejectedByAdvertiser(
    submission: SubmissionWithParties,
    comment: string,
  ) {
    await this.send(
      submission.creator.telegramId,
      `❌ Рекламодатель отклонил ваше видео по заказу «${submission.order.title}».\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
    );
  }

  private async toModerators(
    text: string,
    approveData: string,
    rejectData: string,
  ) {
    const kb = html(
      Markup.inlineKeyboard([
        styled(Markup.button.callback('✅ Одобрить', approveData), 'success'),
        styled(Markup.button.callback('❌ Отклонить', rejectData), 'danger'),
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

  /** Каждому креатору один раз, даже если у него несколько попыток по заказу. */
  private async toCreators(order: OrderWithCreators, text: string) {
    const seen = new Set<bigint>();
    for (const s of order.submissions) {
      if (seen.has(s.creator.telegramId)) continue;
      seen.add(s.creator.telegramId);
      await this.send(s.creator.telegramId, text, true);
    }
  }

  private async send(telegramId: bigint, text: string, asHtml = false) {
    try {
      await this.bot.telegram.sendMessage(
        telegramId.toString(),
        text,
        asHtml ? html() : undefined,
      );
    } catch {
      // получатель мог заблокировать бота
    }
  }
}

type OrderWithCreators = Order & {
  submissions: { creator: { telegramId: bigint } }[];
};
