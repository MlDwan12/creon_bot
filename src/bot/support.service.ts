import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';
import { escapeHtml, html } from './utils/format';

/** Метка пользователя в сообщении для поддержки; по ней ответ находит адресата. */
const USER_TAG_RE = /#u(\d+)/;

/**
 * Поддержка через бота: пользователь пишет боту — сообщение уходит в чат поддержки (SUPPORT_CHAT_ID)
 * с меткой #u<telegram id>; поддержка отвечает реплаем — бот доставляет ответ пользователю.
 * Контакты сторон и поддержки друг другу не видны. Без SUPPORT_CHAT_ID поддержка выключена.
 * ponytail: без лимита на число сообщений — пока пишут единицы; флуд — лимит по пользователю.
 */
@Injectable()
export class SupportService {
  readonly chatId: string | null;
  private botUsername?: Promise<string>;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('SUPPORT_CHAT_ID') || null;
  }

  /** Ссылка на чат с ботом — туда пишут в поддержку; null — поддержка выключена. */
  async url(): Promise<string | null> {
    if (!this.chatId) return null;
    this.botUsername ??= this.bot.telegram.getMe().then((me) => me.username);
    return `https://t.me/${await this.botUsername}`;
  }

  isSupportChat(chatId: number | bigint) {
    return this.chatId !== null && String(chatId) === this.chatId;
  }

  /** Сообщение из формы в мини-аппе — в поддержку, как если бы человек написал боту. */
  async fromApp(
    user: {
      telegramId: bigint;
      username: string | null;
      firstName: string | null;
    },
    text: string,
  ) {
    const who = user.username ? `@${user.username}` : (user.firstName ?? '');
    await this.bot.telegram.sendMessage(
      this.chatId!,
      `${escapeHtml(`✉️ #u${user.telegramId} · ${who} · из приложения`)}\n\n${escapeHtml(text)}`,
      html(),
    );
  }

  /** Сообщение пользователя → в поддержку. false — такой тип сообщения не пересылаем. */
  async fromUser(ctx: Context): Promise<boolean> {
    const msg = ctx.message as Message;
    const from = ctx.from!;
    const who = from.username ? `@${from.username}` : from.first_name;
    const header = `✉️ #u${from.id} · ${who}`;
    if ('text' in msg) {
      await this.bot.telegram.sendMessage(
        this.chatId!,
        `${escapeHtml(header)}\n\n${escapeHtml(msg.text)}`,
        html(),
      );
      return true;
    }
    // фото, видео, документ, голосовое — копией с меткой в подписи
    if (
      'photo' in msg ||
      'video' in msg ||
      'document' in msg ||
      'voice' in msg
    ) {
      const caption =
        'caption' in msg && msg.caption ? `\n\n${msg.caption}` : '';
      await this.bot.telegram.copyMessage(
        this.chatId!,
        msg.chat.id,
        msg.message_id,
        {
          caption: `${header}${caption}`,
        },
      );
      return true;
    }
    return false;
  }

  /**
   * Сообщение из чата поддержки. Реплай на пересланное — ответ пользователю;
   * возвращает текст для поддержки, если ответ не доставлен или это не реплай.
   */
  async fromSupport(ctx: Context): Promise<string | null> {
    const msg = ctx.message as Message;
    const original =
      'reply_to_message' in msg ? msg.reply_to_message : undefined;
    const source =
      original &&
      ('text' in original
        ? original.text
        : 'caption' in original
          ? original.caption
          : '');
    const userId = source?.match(USER_TAG_RE)?.[1];
    if (!userId)
      return 'Чтобы ответить, сделайте реплай на сообщение пользователя.';
    try {
      if ('text' in msg)
        await this.bot.telegram.sendMessage(
          userId,
          `💬 Поддержка CreON:\n\n${msg.text}`,
        );
      else
        await this.bot.telegram.copyMessage(
          userId,
          msg.chat.id,
          msg.message_id,
        );
      return null;
    } catch {
      return 'Не доставлено: пользователь заблокировал бота.';
    }
  }

  /** Поддержке: рекламодатель принял видео — нужно рассчитаться (оплата пока вне бота). */
  async paymentDue(text: string) {
    if (!this.chatId) return;
    try {
      await this.bot.telegram.sendMessage(this.chatId, text, html());
    } catch {
      // поддержка ещё не запускала бота
    }
  }
}
