import { ConfigService } from '@nestjs/config';
import { Action, Ctx, Start, Update } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import {
  moderatorMenuKeyboard,
  userMenuKeyboard,
} from '../keyboards/menu.keyboard';
import { styled } from '../utils/button.util';
import { html } from '../utils/format';
import { isModerator, parseModeratorIds } from '../utils/moderator.util';

function shortIntroText(): string {
  return [
    '👋 CreON — биржа заказов на видео.',
    '',
    'Рекламодатели публикуют задания, креаторы берутся за них и получают оплату за готовую работу.',
  ].join('\n');
}

function howItWorksText(): string {
  return [
    'ℹ️ Как это работает',
    '',
    '1️⃣ Рекламодатель размещает заказ — что снять и какие требования',
    '2️⃣ Модератор проверяет заказ и публикует его',
    '3️⃣ Креатор откликается, а когда видео готово — присылает ссылку',
    '4️⃣ Модератор проверяет ролик',
    '5️⃣ Рекламодатель смотрит и подтверждает — заказ выполнен 🎉',
    '',
    'Вы можете быть и заказчиком, и исполнителем — в меню под сообщением есть разделы для обеих ролей.',
  ].join('\n');
}

function introKeyboard() {
  return html(
    Markup.inlineKeyboard([
      [
        styled(
          Markup.button.callback('ℹ️ Как это работает', 'info:how-it-works'),
          'primary',
        ),
      ],
    ]),
  );
}

/** Приветствие, «Как это работает» и общая заглушка `noop` для неактивных кнопок каруселей. */
@Update()
export class StartUpdate {
  private readonly moderatorIds: Set<string>;

  constructor(config: ConfigService) {
    this.moderatorIds = parseModeratorIds(config.get<string>('MODERATOR_IDS'));
  }

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
    if (isModerator(ctx.from!.id, this.moderatorIds)) {
      await ctx.reply(
        [
          '🛡 CreON Moderation',
          '',
          'Вы — модератор площадки: проверяете новые заказы перед публикацией и готовые видео перед тем, как они попадут к рекламодателю.',
          '',
          '🆕 Заказы на проверку — новые заказы, ждущие публикации',
          '🎬 Видео на проверку — готовые работы креаторов',
          '📋 Все заказы — полный список заказов на площадке',
          '📊 Статистика — сводка по заказам и откликам',
        ].join('\n'),
        moderatorMenuKeyboard(),
      );
      return;
    }
    await ctx.reply(shortIntroText(), introKeyboard());
    await ctx.reply('Выберите действие в меню 👇', userMenuKeyboard());
  }

  @Action('info:how-it-works')
  async onHowItWorks(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      howItWorksText(),
      html(
        Markup.inlineKeyboard([
          [styled(Markup.button.callback('◀️ Назад', 'info:back'), 'primary')],
        ]),
      ),
    );
  }

  @Action('info:back')
  async onInfoBack(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(shortIntroText(), introKeyboard());
  }

  @Action('noop')
  async onNoop(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
  }
}
