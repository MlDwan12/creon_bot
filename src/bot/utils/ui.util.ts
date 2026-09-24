import { Markup } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';

export const PAGE_SIZE = 5;

type MessageExtra = Parameters<BotContext['reply']>[1] &
  Parameters<BotContext['editMessageText']>[1];

/** Группы захвата из регулярки в @Action — nestjs-telegraf кладёт их в `ctx.match`, но в типах контекста его нет. */
export function getMatch(ctx: BotContext): RegExpMatchArray {
  return (ctx as unknown as { match: RegExpMatchArray }).match;
}

/** Строка карусели «◀️ N / M ▶️»; `callback(i)` строит callback-данные для позиции i. */
export function navRow(
  index: number,
  total: number,
  callback: (i: number) => string,
) {
  return [
    index > 0
      ? Markup.button.callback('◀️', callback(index - 1))
      : Markup.button.callback(' ', 'noop'),
    Markup.button.callback(`${index + 1} / ${total}`, 'noop'),
    index + 1 < total
      ? Markup.button.callback('▶️', callback(index + 1))
      : Markup.button.callback(' ', 'noop'),
  ];
}

/** Правит текущее сообщение (навигация по inline-кнопкам) или шлёт новое (вход из меню). */
export async function replyOrEdit(
  ctx: BotContext,
  text: string,
  extra: MessageExtra | undefined,
  edit: boolean,
) {
  if (edit) await ctx.editMessageText(text, extra);
  else await ctx.reply(text, extra);
}

/** Кнопка «✖️ Закрыть»: удаляет сообщение, а если Telegram не даёт (старше 48 часов) — заменяет текст. */
export async function closeMessage(
  ctx: BotContext,
  fallback = 'Список закрыт.',
) {
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch {
    await ctx.editMessageText(fallback);
  }
}
