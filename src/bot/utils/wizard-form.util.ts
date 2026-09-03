import { Markup, type Types } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';

type ExtraReplyMessage = Types.ExtraReplyMessage;
type ExtraEditMessageText = Types.ExtraEditMessageText;

/**
 * Hides the persistent reply keyboard without leaving a visible message.
 * A message carrying `remove_keyboard` can never be edited afterwards (Bot API restriction),
 * so this must never be the wizard's own anchor message — send it separately and delete it right away.
 */
export async function hideReplyKeyboard(ctx: BotContext): Promise<void> {
  const message = await ctx.reply('.', Markup.removeKeyboard());
  try {
    await ctx.telegram.deleteMessage(ctx.chat!.id, message.message_id);
  } catch {
    // best-effort cleanup
  }
}

/**
 * Restores a persistent reply keyboard without a visible "what's next" filler message —
 * the keyboard sticks to the chat even after its carrier message is deleted.
 */
export async function restoreReplyKeyboard(
  ctx: BotContext,
  keyboard: ExtraReplyMessage,
): Promise<void> {
  const message = await ctx.reply('.', keyboard);
  try {
    await ctx.telegram.deleteMessage(ctx.chat!.id, message.message_id);
  } catch {
    // best-effort cleanup
  }
}

/** Deletes the message that triggered the current update, to keep the chat tidy while filling a form. */
export async function deleteIncoming(ctx: BotContext): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // already gone, or older than 48h — ignore
  }
}

/** Sends the anchor message a wizard form will keep editing in place; returns its id. */
export async function sendForm(
  ctx: BotContext,
  text: string,
  extra?: ExtraReplyMessage,
): Promise<number> {
  const message = await ctx.reply(text, extra);
  return message.message_id;
}

/** Edits the wizard's anchor message in place instead of sending a new one. */
export async function editForm(
  ctx: BotContext,
  messageId: number,
  text: string,
  extra?: ExtraEditMessageText,
): Promise<void> {
  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    messageId,
    undefined,
    text,
    extra,
  );
}
