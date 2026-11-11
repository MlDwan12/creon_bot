import { setBotPolling } from '../monitoring/metrics';
import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Action,
  Command,
  Ctx,
  InjectBot,
  On,
  Start,
  Update,
} from 'nestjs-telegraf';
import { Context, Markup, Telegraf, TelegramError } from 'telegraf';
import { translator, userLang } from '../i18n/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { SupportService } from '../support/support.service';
import { LOGIN_START_PREFIX, WebLoginService } from '../auth/web-login.service';

/** Пауза перед повтором, если Telegram недоступен при запуске. */
const LAUNCH_RETRY_MS = 10_000;

/**
 * Вход в Mini App и поддержка: любое другое сообщение боту уходит менеджеру (SupportService),
 * ответ менеджера — обратно пользователю. Старые кнопки (до переезда в мини-апп) — подсказка.
 */
@Update()
export class StartUpdate
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StartUpdate.name);
  private readonly webAppUrl: string;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
    private readonly webLogin: WebLoginService,
    config: ConfigService,
  ) {
    this.webAppUrl = config.get<string>('WEBAPP_URL')!.replace(/\/$/, '');
  }

  private stopping = false;

  /** Кнопка меню слева от поля ввода — для всех чатов с ботом. */
  async onApplicationBootstrap() {
    void this.launch();
    try {
      await this.bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: 'Fixum',
          web_app: { url: this.webAppUrl },
        },
      });
    } catch (err) {
      this.logger.error(err);
    }
  }

  onApplicationShutdown() {
    this.stopping = true;
  }

  /**
   * Long polling. Сбой сети при запуске (getMe) — повторяем. Polling встал насовсем (второй
   * экземпляр с тем же токеном — 409, отозванный токен — 401) — процесс завершается: HTTP без
   * бота выглядел бы живым для healthcheck, а Docker перезапустит контейнер (restart: unless-stopped).
   */
  private async launch() {
    while (!this.stopping) {
      try {
        // промис завершается, только когда polling остановлен; колбэк — когда запустился
        await this.bot.launch(() => setBotPolling(true));
        setBotPolling(false);
        return;
      } catch (err) {
        setBotPolling(false);
        if (this.stopping) return;
        const fatal =
          err instanceof TelegramError && err.code < 500 && err.code !== 429;
        this.logger.error(err);
        if (fatal) {
          this.logger.error('Бот остановлен — перезапуск процесса');
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, LAUNCH_RETRY_MS));
      }
    }
  }

  /**
   * Перевод на язык собеседника: выбранный в профиле мини-аппа, иначе язык его Telegram. Человек мог
   * ещё ни разу не открывать мини-апп — тогда в базе его нет, берём язык из сообщения.
   */
  private async t(ctx: Context) {
    const user = ctx.from
      ? await this.prisma.user.findUnique({
          where: { telegramId: BigInt(ctx.from.id) },
          select: { language: true },
        })
      : null;
    return translator(
      userLang({
        language: user?.language ?? null,
        telegramLanguage: ctx.from?.language_code ?? null,
      }),
    );
  }

  /** Бан без права обжалования — бот молчит на всё: /start, команды, кнопки, сообщения. */
  private async silenced(ctx: Context) {
    if (!ctx.from) return false;
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
      select: { bannedAt: true, banFinal: true },
    });
    return !!user?.bannedAt && user.banFinal;
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (await this.silenced(ctx)) return;
    const t = await this.t(ctx);
    // ссылка входа на сайт: код — тому, кто её открыл (WebLoginService)
    const payload = 'payload' in ctx ? String(ctx.payload) : '';
    if (
      payload.startsWith(LOGIN_START_PREFIX) &&
      ctx.chat?.type === 'private'
    ) {
      const code = await this.webLogin.issueCode(
        payload.slice(LOGIN_START_PREFIX.length),
        ctx.from!,
      );
      await ctx.reply(
        code ? t('bot.loginCode', { code }) : t('bot.loginExpired'),
      );
      return;
    }
    await ctx.reply(
      t('bot.intro'),
      Markup.inlineKeyboard([
        Markup.button.webApp(t('bot.openApp'), this.webAppUrl),
      ]),
    );
  }

  /** Telegram ждёт от ботов команду /privacy. Обработчик — до @On('message'), иначе тот перехватит. */
  @Command('privacy')
  async onPrivacy(@Ctx() ctx: Context) {
    if (await this.silenced(ctx)) return;
    const t = await this.t(ctx);
    await ctx.reply(
      t('bot.privacy'),
      Markup.inlineKeyboard([
        Markup.button.webApp(t('bot.open'), `${this.webAppUrl}/privacy`),
      ]),
    );
  }

  /** ID чата — чтобы узнать ID группы поддержки для SUPPORT_CHAT_ID. */
  @Command('chatid')
  async onChatId(@Ctx() ctx: Context) {
    if (await this.silenced(ctx)) return;
    await ctx.reply(`ID этого чата: ${ctx.chat!.id}`);
  }

  /** Кнопки в старых сообщениях — их обработчиков больше нет. */
  @Action(/.*/)
  async onOldButton(@Ctx() ctx: Context) {
    if (await this.silenced(ctx)) return;
    await ctx.answerCbQuery((await this.t(ctx))('bot.moved'), {
      show_alert: true,
    });
  }

  /**
   * Личное сообщение — в тему пользователя в группе поддержки; сообщение в теме группы — пользователю.
   * Заодно убирает старую клавиатуру. Другие группы (если бота туда добавят) игнорируем.
   */
  @On('message')
  async onMessage(@Ctx() ctx: Context) {
    if (this.support.isSupportChat(ctx.chat!.id)) {
      await this.support.fromSupport(ctx);
      return;
    }
    if (ctx.chat!.type !== 'private' || (await this.silenced(ctx))) return;
    const t = await this.t(ctx);
    if (!this.support.chatId) {
      await ctx.reply(t('bot.moved'), Markup.removeKeyboard());
      return;
    }
    const result = await this.support.fromUser(ctx);
    await ctx.reply(
      t(
        {
          sent: 'bot.supportSent',
          unsupported: 'bot.supportUnsupported',
          flood: 'bot.supportFlood',
          busy: 'bot.supportBusy',
        }[result],
      ),
      Markup.removeKeyboard(),
    );
  }
}
