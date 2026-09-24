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

const INTRO = [
  '👋 CreON — биржа заказов на видео.',
  '',
  'Рекламодатели публикуют задания, креаторы берутся за них и получают оплату за готовую работу.',
  '',
  'Заказы, отклики и модерация — в приложении 👇',
].join('\n');

const MOVED =
  'Бот обновился — всё теперь в приложении. Откройте его кнопкой «CreON» слева от поля ввода.';

/** Вход в Mini App. Остальные сообщения и старые кнопки (до переезда в мини-апп) — подсказка открыть его. */
@Update()
export class StartUpdate implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartUpdate.name);
  private readonly webAppUrl: string;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
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

  /** Заодно убирает старую нижнюю клавиатуру с разделами. */
  @On('message')
  async onMessage(@Ctx() ctx: Context) {
    await ctx.reply(MOVED, Markup.removeKeyboard());
  }
}
