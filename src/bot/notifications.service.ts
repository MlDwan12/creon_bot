import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, Submission, User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
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
 * Все уведомления в чат бота о событиях из Mini App. К каждому — кнопка, открывающая нужный экран.
 * Каждая отправка глушит ошибку: получатель мог заблокировать бота или ещё не запускал его.
 */
@Injectable()
export class NotificationsService {
  private readonly moderatorIds: string[];
  private readonly webAppUrl: string;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    );
    this.webAppUrl = config.get<string>('WEBAPP_URL')!.replace(/\/$/, '');
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
    await this.toModerators(text, `/mod/orders/${order.id}`);
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
    await this.toModerators(text, `/mod/videos/${submission.id}`);
  }

  /** Рекламодателю: модератор опубликовал заказ. */
  async orderApproved(order: Order & { advertiser: User }) {
    await this.send(
      order.advertiser.telegramId,
      `✅ Ваш заказ «${order.title}» прошёл модерацию и опубликован — креаторы уже видят его в каталоге.`,
      '/my-orders',
    );
  }

  /** Рекламодателю: модератор отклонил заказ. */
  async orderRejected(order: Order & { advertiser: User }, comment: string) {
    await this.send(
      order.advertiser.telegramId,
      `❌ Ваш заказ «${order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете разместить заказ заново, учтя замечания.`,
      `/my-orders/new?from=${order.id}`,
    );
  }

  /** Рекламодателю: модератор одобрил видео — теперь решение за ним. */
  async videoApprovedByModerator(
    submission: Submission & { order: Order & { advertiser: User } },
  ) {
    const text = [
      '🎬 Новое видео на проверку',
      '',
      `Заказ: ${escapeHtml(submission.order.title)}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    await this.send(
      submission.order.advertiser.telegramId,
      text,
      `/my-orders/${submission.order.id}/review`,
      true,
    );
  }

  /** Креатору: модератор отклонил видео. */
  async videoRejectedByModerator(
    submission: SubmissionWithParties,
    comment: string,
  ) {
    await this.send(
      submission.creator.telegramId,
      `❌ Ваш отклик на заказ «${submission.order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
      '/submissions',
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
      '/submissions',
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
      '/submissions',
    );
  }

  private async toModerators(text: string, path: string) {
    const extra = html(this.openButton(path));
    for (const modId of this.moderatorIds) {
      try {
        await this.bot.telegram.sendMessage(modId, text, extra);
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
      await this.send(s.creator.telegramId, text, '/submissions', true);
    }
  }

  private async send(
    telegramId: bigint,
    text: string,
    path: string,
    asHtml = false,
  ) {
    const kb = this.openButton(path);
    try {
      await this.bot.telegram.sendMessage(
        telegramId.toString(),
        text,
        asHtml ? html(kb) : kb,
      );
    } catch {
      // получатель мог заблокировать бота
    }
  }

  /** Кнопка web_app работает только в личных чатах — все уведомления как раз туда. */
  private openButton(path: string) {
    return Markup.inlineKeyboard([
      Markup.button.webApp('Открыть', this.webAppUrl + path),
    ]);
  }
}

type OrderWithCreators = Order & {
  submissions: { creator: { telegramId: bigint } }[];
};
