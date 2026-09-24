import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';
import { PrismaService } from '../prisma/prisma.service';
import { creatorLabel, escapeHtml, html } from './utils/format';

/** Telegram ограничивает название темы 128 символами. */
const MAX_TOPIC_NAME = 128;

/**
 * Поддержка через бота в группе-форуме (SUPPORT_CHAT_ID, темы включены, бот — админ с правом
 * управлять темами). У каждого пользователя своя тема: его сообщения боту и из формы в мини-аппе
 * идут туда, любое сообщение поддержки в теме бот доставляет ему. `/close` в теме закрывает
 * обращение, новое сообщение пользователя открывает её снова. «К оплате» — в общую тему (General).
 * Контакты сторон и поддержки друг другу не видны. Без SUPPORT_CHAT_ID поддержка выключена.
 * ponytail: без лимита на число сообщений в чате с ботом — флуд ограничить по пользователю, если появится.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  readonly chatId: string | null;
  private botUsername?: Promise<string>;
  /** Тема создаётся один раз, даже если человек прислал два сообщения подряд. */
  private readonly creating = new Map<number, Promise<number>>();

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('SUPPORT_CHAT_ID') || null;
  }

  /** Ссылка на чат с ботом (для заблокированных: API им закрыт); null — поддержка выключена. */
  async url(): Promise<string | null> {
    if (!this.chatId) return null;
    this.botUsername ??= this.bot.telegram.getMe().then((me) => me.username);
    return `https://t.me/${await this.botUsername}`;
  }

  isSupportChat(chatId: number) {
    return this.chatId !== null && String(chatId) === this.chatId;
  }

  /** Сообщение пользователя боту → в его тему. false — такой тип сообщения не пересылаем. */
  async fromUser(ctx: Context): Promise<boolean> {
    const msg = ctx.message as Message;
    const media =
      'photo' in msg || 'video' in msg || 'document' in msg || 'voice' in msg;
    if (!('text' in msg) && !media) return false;

    const from = ctx.from!;
    const user = await this.prisma.user.upsert({
      where: { telegramId: BigInt(from.id) },
      update: { username: from.username, firstName: from.first_name },
      create: {
        telegramId: BigInt(from.id),
        username: from.username,
        firstName: from.first_name,
      },
    });
    await this.toTopic(user, (thread) =>
      'text' in msg
        ? this.bot.telegram.sendMessage(this.chatId!, msg.text, {
            message_thread_id: thread,
          })
        : this.bot.telegram.copyMessage(
            this.chatId!,
            msg.chat.id,
            msg.message_id,
            {
              message_thread_id: thread,
            },
          ),
    );
    return true;
  }

  /** Сообщение из формы в мини-аппе → в тему пользователя, с пометкой. */
  async fromApp(user: User, text: string) {
    await this.toTopic(user, (thread) =>
      this.bot.telegram.sendMessage(
        this.chatId!,
        `📱 <i>из приложения</i>\n\n${escapeHtml(text)}`,
        { ...html(), message_thread_id: thread },
      ),
    );
  }

  /** Сообщение сотрудника в теме → пользователю; `/close` — закрыть обращение. */
  async fromSupport(ctx: Context) {
    const msg = ctx.message as Message;
    const thread = msg.message_thread_id;
    // общая тема (оплаты, служебное) и служебные сообщения о темах — не пользователям
    if (!('is_topic_message' in msg) || !msg.is_topic_message || !thread)
      return;
    if (msg.from?.is_bot) return;
    const user = await this.prisma.user.findFirst({
      where: { supportTopicId: thread },
    });
    if (!user) return;

    const reply = (text: string) =>
      this.bot.telegram.sendMessage(this.chatId!, text, {
        message_thread_id: thread,
      });
    try {
      if ('text' in msg && msg.text.startsWith('/close')) {
        await this.bot.telegram.sendMessage(
          String(user.telegramId),
          '✅ Обращение закрыто. Если остались вопросы — просто напишите сюда.',
        );
        await this.bot.telegram.closeForumTopic(this.chatId!, thread);
        return;
      }
      if ('text' in msg)
        await this.bot.telegram.sendMessage(
          String(user.telegramId),
          `💬 Поддержка CreON:\n\n${msg.text}`,
        );
      else if (
        'photo' in msg ||
        'video' in msg ||
        'document' in msg ||
        'voice' in msg
      )
        await this.bot.telegram.copyMessage(
          String(user.telegramId),
          msg.chat.id,
          msg.message_id,
        );
      else
        await reply(
          'Пользователю можно отправить текст, фото, видео, файл или голосовое.',
        );
    } catch {
      await reply('Не доставлено: пользователь заблокировал бота.');
    }
  }

  /** Поддержке, в общую тему: рекламодатель принял видео — нужно рассчитаться (оплата пока вне бота). */
  async paymentDue(text: string) {
    if (!this.chatId) return;
    try {
      await this.bot.telegram.sendMessage(this.chatId, text, html());
    } catch (err) {
      this.logger.error(err);
    }
  }

  /**
   * Отправка в тему пользователя: создаёт её при первом обращении, открывает закрытую.
   * Тему удалили вручную — создаём новую и повторяем один раз.
   */
  private async toTopic(
    user: User,
    send: (thread: number) => Promise<unknown>,
  ) {
    let thread = user.supportTopicId ?? (await this.createTopic(user));
    try {
      await this.bot.telegram
        .reopenForumTopic(this.chatId!, thread)
        .catch(() => {
          // тема и так открыта
        });
      await send(thread);
    } catch (err) {
      if (!/thread not found|TOPIC_ID_INVALID|TOPIC_DELETED/i.test(String(err)))
        throw err;
      thread = await this.createTopic({ ...user, supportTopicId: null });
      await send(thread);
    }
  }

  private createTopic(user: User): Promise<number> {
    let pending = this.creating.get(user.id);
    if (!pending) {
      pending = this.newTopic(user).finally(() =>
        this.creating.delete(user.id),
      );
      this.creating.set(user.id, pending);
    }
    return pending;
  }

  /** Новая тема + карточка пользователя первым сообщением. */
  private async newTopic(user: User): Promise<number> {
    const name = `${creatorLabel(user)} · #u${user.telegramId}`.slice(
      0,
      MAX_TOPIC_NAME,
    );
    const topic = await this.bot.telegram.createForumTopic(this.chatId!, name);
    const thread = topic.message_thread_id;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { supportTopicId: thread },
    });

    const [orders, submissions] = await Promise.all([
      this.prisma.order.count({ where: { advertiserId: user.id } }),
      this.prisma.submission.count({ where: { creatorId: user.id } }),
    ]);
    const card = [
      `👤 <b>${escapeHtml(creatorLabel(user))}</b>${user.firstName && user.username ? ` (${escapeHtml(user.firstName)})` : ''}`,
      `Telegram id: <code>${user.telegramId}</code> · id в CreON: ${user.id}`,
      `Заказов создал: ${orders} · откликов: ${submissions}`,
      user.bannedAt
        ? `🚫 Заблокирован: ${escapeHtml(user.banReason ?? '')}`
        : '',
      '',
      'Пишите ответ прямо в эту тему — бот передаст его пользователю. /close — закрыть обращение.',
    ]
      .filter((line, i, all) => line || all[i - 1])
      .join('\n');
    await this.bot.telegram.sendMessage(this.chatId!, card, {
      ...html(),
      message_thread_id: thread,
    });
    return thread;
  }
}
