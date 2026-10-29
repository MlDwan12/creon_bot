import { translator, userLang } from '../i18n/i18n';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';
import { PrismaService } from '../prisma/prisma.service';
import { creatorLabel, escapeHtml, html } from '../common/format';

/** Telegram ограничивает название темы 128 символами. */
const MAX_TOPIC_NAME = 128;

/**
 * Сколько сообщений можно прислать в поддержку. В группу Telegram пускает около 20 сообщений в
 * минуту на бота: без лимита на человека один флудер заглушил бы поддержку для всех, без общего —
 * несколько аккаунтов сразу. Общий — с запасом под ответы поддержки.
 */
const USER_PER_MINUTE = 5;
const USER_PER_HOUR = 30;
const GROUP_PER_MINUTE = 15;

/** Счётчики за фиксированное окно: по его окончании сбрасываются целиком — память не растёт. */
class FloodWindow {
  private readonly counts = new Map<number | 'all', number>();
  private ends = 0;
  constructor(private readonly ms: number) {}

  /** Учесть ещё одно сообщение и вернуть, сколько их в текущем окне. */
  hit(key: number | 'all', now: number): number {
    if (now >= this.ends) {
      this.counts.clear();
      this.ends = now + this.ms;
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
}

/**
 * Поддержка через бота в группе-форуме (SUPPORT_CHAT_ID, темы включены, бот — админ с правом
 * управлять темами). У каждого пользователя своя тема: его сообщения боту и из формы в мини-аппе
 * идут туда, любое сообщение поддержки в теме бот доставляет ему. `/close` в теме закрывает
 * обращение, новое сообщение пользователя открывает её снова. «К оплате» — в общую тему (General).
 * Контакты сторон и поддержки друг другу не видны. Без SUPPORT_CHAT_ID поддержка выключена.
 */
@Injectable()
export class SupportService implements OnModuleInit {
  private readonly logger = new Logger(SupportService.name);
  readonly chatId: string | null;
  private botUsername?: Promise<string>;
  // ponytail: фиксированные окна в памяти процесса — инстанс один.
  private readonly perMinute = new FloodWindow(60_000);
  private readonly perHour = new FloodWindow(60 * 60_000);

  /** Тема создаётся один раз, даже если человек прислал два сообщения подряд. */
  private readonly creating = new Map<number, Promise<number>>();

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('SUPPORT_CHAT_ID') || null;
  }

  /**
   * Темы, созданные до появления User.supportChatId, — в текущей группе: привязываем их к ней один
   * раз. Дальше тема из другой группы (SUPPORT_CHAT_ID сменили) считается отсутствующей.
   */
  async onModuleInit() {
    if (!this.chatId) return;
    await this.prisma.user.updateMany({
      where: { supportChatId: null, supportTopicId: { not: null } },
      data: { supportChatId: this.chatId },
    });
  }

  /** Ссылка на чат с ботом (для заблокированных: API им закрыт); null — поддержка выключена. */
  async url(): Promise<string | null> {
    if (!this.chatId) return null;
    this.botUsername ??= this.bot.telegram.getMe().then((me) => me.username);
    try {
      return `https://t.me/${await this.botUsername}`;
    } catch {
      // Telegram недоступен: без ссылки, но /api/me не должен падать (иначе модератор
      // не попадёт в своё окно). Кеш сбрасываем, чтобы следующий запрос попробовал снова.
      this.botUsername = undefined;
      return null;
    }
  }

  isSupportChat(chatId: number) {
    return this.chatId !== null && String(chatId) === this.chatId;
  }

  /**
   * Можно ли отправить это сообщение в поддержку (считает и его): 'flood' — человек пишет слишком
   * часто, 'busy' — в группу и так идёт предел сообщений от всех.
   */
  allowMessage(telegramId: number): 'ok' | 'flood' | 'busy' {
    const now = Date.now();
    if (
      this.perMinute.hit(telegramId, now) > USER_PER_MINUTE ||
      this.perHour.hit(telegramId, now) > USER_PER_HOUR
    )
      return 'flood';
    return this.perMinute.hit('all', now) > GROUP_PER_MINUTE ? 'busy' : 'ok';
  }

  /**
   * Сообщение пользователя боту → в его тему. 'unsupported' — такой тип не пересылаем,
   * 'flood'/'busy' — не отправлено (allowMessage).
   */
  async fromUser(
    ctx: Context,
  ): Promise<'sent' | 'unsupported' | 'flood' | 'busy'> {
    const msg = ctx.message as Message;
    const media =
      'photo' in msg || 'video' in msg || 'document' in msg || 'voice' in msg;
    if (!('text' in msg) && !media) return 'unsupported';

    const from = ctx.from!;
    const allowed = this.allowMessage(from.id);
    if (allowed !== 'ok') return allowed;
    const user = await this.prisma.user.upsert({
      where: { telegramId: BigInt(from.id) },
      // null, а не undefined: убранный в Telegram username должен стереться и здесь
      update: { username: from.username ?? null, firstName: from.first_name },
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
    return 'sent';
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
      where: { supportChatId: this.chatId, supportTopicId: thread },
    });
    if (!user) return;

    const reply = (text: string) =>
      this.bot.telegram.sendMessage(this.chatId!, text, {
        message_thread_id: thread,
      });
    if (user.bannedAt && user.banFinal) {
      await reply(
        'Не доставлено: пользователь заблокирован без права обжалования.',
      );
      return;
    }
    try {
      if ('text' in msg && msg.text.startsWith('/close')) {
        await this.bot.telegram.sendMessage(
          String(user.telegramId),
          translator(userLang(user))('bot.supportClosed'),
        );
        await this.bot.telegram.closeForumTopic(this.chatId!, thread);
        return;
      }
      if ('text' in msg)
        await this.bot.telegram.sendMessage(
          String(user.telegramId),
          translator(userLang(user))('bot.supportReply', { text: msg.text }),
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
    } catch (err) {
      if (/bot was blocked|user is deactivated/i.test(String(err))) {
        await reply('Не доставлено: пользователь заблокировал бота.');
        return;
      }
      this.logger.error(err);
      await reply('Не доставлено — сбой Telegram, попробуйте ещё раз.');
    }
  }

  /** Поддержке, в общую тему: креатор запросил вывод — нужно перевести (выплаты пока вручную). */
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
    // тема из прежней группы поддержки здесь — чужая: заводим новую
    const own = user.supportChatId === this.chatId ? user.supportTopicId : null;
    let thread = own ?? (await this.createTopic(user));
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
      data: { supportTopicId: thread, supportChatId: this.chatId },
    });

    const [orders, submissions] = await Promise.all([
      this.prisma.order.count({ where: { advertiserId: user.id } }),
      this.prisma.submission.count({ where: { creatorId: user.id } }),
    ]);
    const card = [
      `👤 <b>${escapeHtml(creatorLabel(user))}</b>${user.firstName && user.username ? ` (${escapeHtml(user.firstName)})` : ''}`,
      `Telegram id: <code>${user.telegramId}</code> · id в Fixum: ${user.id}`,
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
