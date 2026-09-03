import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderCategory } from '@prisma/client';
import { Action, Command, Ctx, On, Scene, SceneEnter } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { getCurrentUser } from '../interfaces/bot-context.interface';
import { userMenuKeyboard } from '../keyboards/menu.keyboard';
import { styled } from '../utils/button.util';
import {
  creatorLabel,
  escapeHtml,
  formatDeadline,
  html,
  orderCategoryLabel,
  ORDER_CATEGORIES,
  truncate,
} from '../utils/format';
import { parseModeratorIds } from '../utils/moderator.util';
import {
  isMeaningfulText,
  MAX_DEADLINE_DAYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE_LENGTH,
  MAX_TITLE_LENGTH,
} from '../utils/validation';
import {
  deleteIncoming,
  editForm,
  hideReplyKeyboard,
  restoreReplyKeyboard,
  sendForm,
} from '../utils/wizard-form.util';
import { OrdersService } from '../../orders/orders.service';

export const CREATE_ORDER_SCENE_ID = 'create-order';

type FieldKey = 'title' | 'description' | 'price' | 'deadline';

interface CreateOrderState {
  formMessageId?: number;
  title?: string;
  description?: string;
  price?: string;
  priceTouched?: boolean;
  category: OrderCategory;
  deadlineDays?: number;
  deadlineTouched?: boolean;
  editingField?: FieldKey;
}

const HEADER = '📦 Новый заказ';

const FIELD_PROMPTS: Record<FieldKey, string> = {
  title: 'Введите название заказа:',
  description: 'Введите описание и требования к видео:',
  price: 'Введите цену (или "-", если не хотите указывать):',
  deadline:
    'Через сколько дней нужен готовый ролик? Введите число (например, 3), или "-" чтобы не указывать срок:',
};

function deadlineText(state: CreateOrderState): string {
  if (!state.deadlineDays) return 'не указан';
  const date = new Date(Date.now() + state.deadlineDays * 24 * 60 * 60 * 1000);
  return `через ${state.deadlineDays} дн. (${formatDeadline(date)})`;
}

function renderPanel(state: CreateOrderState): string {
  const titleDone = Boolean(state.title);
  const descDone = Boolean(state.description);
  return [
    `<b>${HEADER}</b>`,
    '',
    `${titleDone ? '✅' : '⚪'} Название: ${state.title ? escapeHtml(truncate(state.title)) : '—'}`,
    `${descDone ? '✅' : '⚪'} Описание: ${state.description ? escapeHtml(truncate(state.description)) : '—'}`,
    `${state.priceTouched ? '✅' : '⚪'} Цена: ${state.price ? escapeHtml(state.price) : 'не указана'}`,
    `✅ Категория: ${orderCategoryLabel(state.category)}`,
    `${state.deadlineTouched ? '✅' : '⚪'} Дедлайн: ${deadlineText(state)}`,
  ].join('\n');
}

function renderPreview(state: CreateOrderState): string {
  return [
    '👁 Так заказ увидят креаторы в «Доступных заказах»:',
    '',
    '📦 <b>Заказ #…</b> — ✅ открыт',
    `<b>${escapeHtml(state.title!)}</b>`,
    escapeHtml(state.description!),
    orderCategoryLabel(state.category),
    state.price ? `💰 ${escapeHtml(state.price)}` : '💰 цена не указана',
    state.deadlineDays
      ? `⏰ Дедлайн: ${formatDeadline(new Date(Date.now() + state.deadlineDays * 24 * 60 * 60 * 1000))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function panelKeyboard() {
  return html(
    Markup.inlineKeyboard([
      [
        styled(Markup.button.callback('✏️ Название', 'field:title'), 'primary'),
        styled(
          Markup.button.callback('✏️ Описание', 'field:description'),
          'primary',
        ),
      ],
      [
        styled(Markup.button.callback('✏️ Цена', 'field:price'), 'primary'),
        styled(
          Markup.button.callback('⏰ Дедлайн', 'field:deadline'),
          'primary',
        ),
      ],
      [
        styled(
          Markup.button.callback('📁 Категория', 'field:category'),
          'primary',
        ),
        styled(Markup.button.callback('👁 Превью', 'form:preview'), 'primary'),
      ],
      [
        styled(
          Markup.button.callback('✅ Отправить на модерацию', 'form:publish'),
          'success',
        ),
      ],
      [styled(Markup.button.callback('✖️ Отмена', 'form:cancel'), 'danger')],
    ]),
  );
}

function promptKeyboard() {
  return html(
    Markup.inlineKeyboard([
      [styled(Markup.button.callback('◀️ Назад', 'field:back'), 'primary')],
    ]),
  );
}

function categoryKeyboard() {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < ORDER_CATEGORIES.length; i += 2) {
    rows.push(
      ORDER_CATEGORIES.slice(i, i + 2).map((c) =>
        styled(
          Markup.button.callback(c.label, `category:${c.code}`),
          'primary',
        ),
      ),
    );
  }
  rows.push([
    styled(Markup.button.callback('◀️ Назад', 'field:back'), 'primary'),
  ]);
  return html(Markup.inlineKeyboard(rows));
}

@Injectable()
@Scene(CREATE_ORDER_SCENE_ID)
export class CreateOrderScene {
  private readonly moderatorIds: string[];

  constructor(
    private readonly ordersService: OrdersService,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    );
  }

  @SceneEnter()
  async onEnter(@Ctx() ctx: BotContext) {
    await deleteIncoming(ctx);
    await hideReplyKeyboard(ctx);
    const state = ctx.scene.state as CreateOrderState;
    state.category = state.category ?? 'OTHER';
    state.formMessageId = await sendForm(
      ctx,
      renderPanel(state),
      panelKeyboard(),
    );
  }

  @Action(/^field:(title|description|price|deadline)$/)
  async onEditField(@Ctx() ctx: BotContext) {
    const field = (ctx as unknown as { match: RegExpMatchArray })
      .match[1] as FieldKey;
    const state = ctx.scene.state as CreateOrderState;
    state.editingField = field;
    await ctx.answerCbQuery();
    await editForm(
      ctx,
      state.formMessageId!,
      `<b>${HEADER}</b>\n\n${FIELD_PROMPTS[field]}`,
      promptKeyboard(),
    );
  }

  @Action('field:category')
  async onEditCategory(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    await ctx.answerCbQuery();
    await editForm(
      ctx,
      state.formMessageId!,
      `<b>${HEADER}</b>\n\nВыберите категорию:`,
      categoryKeyboard(),
    );
  }

  @Action(/^category:(.+)$/)
  async onCategoryPicked(@Ctx() ctx: BotContext) {
    const code = (ctx as unknown as { match: RegExpMatchArray }).match[1];
    if (!ORDER_CATEGORIES.some((c) => c.code === code)) {
      await ctx.answerCbQuery('Неизвестная категория');
      return;
    }
    const state = ctx.scene.state as CreateOrderState;
    state.category = code as OrderCategory;
    await ctx.answerCbQuery();
    await editForm(
      ctx,
      state.formMessageId!,
      renderPanel(state),
      panelKeyboard(),
    );
  }

  @Action('field:back')
  async onFieldBack(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    state.editingField = undefined;
    await ctx.answerCbQuery();
    await editForm(
      ctx,
      state.formMessageId!,
      renderPanel(state),
      panelKeyboard(),
    );
  }

  @Action('form:preview')
  async onPreview(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    if (!state.title || !state.description) {
      await ctx.answerCbQuery('Сначала заполните название и описание');
      return;
    }
    await ctx.answerCbQuery();
    await editForm(
      ctx,
      state.formMessageId!,
      renderPreview(state),
      promptKeyboard(),
    );
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    await deleteIncoming(ctx);
    if (state.formMessageId) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat!.id, state.formMessageId);
      } catch {
        // сообщение формы уже могло исчезнуть
      }
    }
    await restoreReplyKeyboard(ctx, userMenuKeyboard());
    await ctx.scene.leave();
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    await deleteIncoming(ctx);
    if (!state.editingField || !ctx.message || !('text' in ctx.message)) return;
    const value = ctx.message.text.trim();
    const retry = (msg: string) =>
      editForm(
        ctx,
        state.formMessageId!,
        `<b>${HEADER}</b>\n\n${msg} Попробуйте ещё раз:`,
        promptKeyboard(),
      );

    if (state.editingField === 'title') {
      if (!value || !isMeaningfulText(value))
        return retry('Название не может быть пустым.');
      if (value.length > MAX_TITLE_LENGTH)
        return retry(
          `Название длиннее ${MAX_TITLE_LENGTH} символов — сократите его.`,
        );
      state.title = value;
    } else if (state.editingField === 'description') {
      if (!value || !isMeaningfulText(value))
        return retry('Описание не может быть пустым.');
      if (value.length > MAX_DESCRIPTION_LENGTH)
        return retry(
          `Описание длиннее ${MAX_DESCRIPTION_LENGTH} символов — сократите его.`,
        );
      state.description = value;
    } else if (state.editingField === 'price') {
      if (value !== '-' && value.length > MAX_PRICE_LENGTH)
        return retry(
          `Слишком длинный текст (максимум ${MAX_PRICE_LENGTH} символов).`,
        );
      state.price = value === '-' ? undefined : value;
      state.priceTouched = true;
    } else if (state.editingField === 'deadline') {
      if (value === '-') {
        state.deadlineDays = undefined;
      } else {
        const days = Number(value);
        if (!Number.isInteger(days) || days <= 0 || days > MAX_DEADLINE_DAYS) {
          return retry(
            `Нужно целое число дней от 1 до ${MAX_DEADLINE_DAYS} (например, 3), или "-" чтобы пропустить.`,
          );
        }
        state.deadlineDays = days;
      }
      state.deadlineTouched = true;
    }
    state.editingField = undefined;
    await editForm(
      ctx,
      state.formMessageId!,
      renderPanel(state),
      panelKeyboard(),
    );
  }

  @Action('form:publish')
  async onPublish(@Ctx() ctx: BotContext) {
    const state = ctx.scene.state as CreateOrderState;
    if (!state.title || !state.description) {
      await ctx.answerCbQuery('Заполните название и описание');
      return;
    }
    const order = await this.ordersService.create(getCurrentUser(ctx).id, {
      title: state.title,
      description: state.description,
      price: state.price,
      category: state.category,
      deadline: state.deadlineDays
        ? new Date(Date.now() + state.deadlineDays * 24 * 60 * 60 * 1000)
        : undefined,
    });
    await ctx.answerCbQuery('Отправлено на модерацию');
    await ctx.editMessageText(
      `🕓 Заказ #${order.id} отправлен на модерацию. Как только его проверят, вы получите уведомление.`,
    );
    await restoreReplyKeyboard(ctx, userMenuKeyboard());

    const notifyText = [
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
    const kb = html(
      Markup.inlineKeyboard([
        styled(
          Markup.button.callback('✅ Одобрить', `order:approve:${order.id}`),
          'success',
        ),
        styled(
          Markup.button.callback('❌ Отклонить', `order:reject:${order.id}`),
          'danger',
        ),
      ]),
    );
    for (const modId of this.moderatorIds) {
      try {
        await ctx.telegram.sendMessage(modId, notifyText, kb);
      } catch {
        // модератор ещё не запускал бота — пропускаем
      }
    }
    await ctx.scene.leave();
  }

  @Action('form:cancel')
  async onCancelForm(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery('✖️ Заказ не опубликован', { show_alert: true });
    try {
      await ctx.deleteMessage();
    } catch {
      // сообщение формы уже могло исчезнуть
    }
    await restoreReplyKeyboard(ctx, userMenuKeyboard());
    await ctx.scene.leave();
  }
}
