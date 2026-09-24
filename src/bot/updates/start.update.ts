import { Logger, OnApplicationBootstrap } from '@nestjs/common';
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
import { Context, Markup, Telegraf } from 'telegraf';
import { SupportService } from '../support.service';

const INTRO = [
  '👋 CreON — биржа заказов на видео.',
  '',
  'Рекламодатели публикуют задания, креаторы берутся за них и получают оплату за готовую работу.',
  '',
  'Заказы, отклики и модерация — в приложении 👇',
  'Вопросы — просто напишите сюда сообщение, ответит менеджер CreON.',
].join('\n');

const MOVED =
  'Бот обновился — всё теперь в приложении. Откройте его кнопкой «CreON» слева от поля ввода.';

/**
 * Вход в Mini App и поддержка: любое другое сообщение боту уходит менеджеру (SupportService),
 * ответ менеджера — обратно пользователю. Старые кнопки (до переезда в мини-апп) — подсказка.
 */
@Update()
export class StartUpdate implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartUpdate.name);
  private readonly webAppUrl: string;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly support: SupportService,
    config: ConfigService,
  ) {
    this.webAppUrl = config.get<string>('WEBAPP_URL')!.replace(/\/$/, '');
  }

  /** Кнопка меню слева от поля ввода — для всех чатов с ботом. */
  async onApplicationBootstrap() {
    try {
      await this.bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: 'CreON',
          web_app: { url: this.webAppUrl },
        },
      });
    } catch (err) {
      this.logger.error(err);
    }
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply(
      INTRO,
      Markup.inlineKeyboard([
        Markup.button.webApp('Открыть CreON', this.webAppUrl),
      ]),
    );
  }

  /** Telegram ждёт от ботов команду /privacy. Обработчик — до @On('message'), иначе тот перехватит. */
  @Command('privacy')
  async onPrivacy(@Ctx() ctx: Context) {
    await ctx.reply(
      'Политика конфиденциальности CreON:',
      Markup.inlineKeyboard([
        Markup.button.webApp('Открыть', `${this.webAppUrl}/privacy`),
      ]),
    );
  }

  /** Кнопки в старых сообщениях — их обработчиков больше нет. */
  @Action(/.*/)
  async onOldButton(@Ctx() ctx: Context) {
    await ctx.answerCbQuery(MOVED, { show_alert: true });
  }

  /** Сообщение — в поддержку (или ответ поддержки — пользователю). Заодно убирает старую клавиатуру. */
  @On('message')
  async onMessage(@Ctx() ctx: Context) {
    if (this.support.isSupportChat(ctx.chat!.id)) {
      const problem = await this.support.fromSupport(ctx);
      if (problem) await ctx.reply(problem);
      return;
    }
    if (!this.support.chatId) {
      await ctx.reply(MOVED, Markup.removeKeyboard());
      return;
    }
    const sent = await this.support.fromUser(ctx);
    await ctx.reply(
      sent
        ? '✅ Передали менеджеру — ответ придёт сюда.'
        : 'Менеджер принимает текст, фото, видео и файлы.',
      Markup.removeKeyboard(),
    );
  }
}
