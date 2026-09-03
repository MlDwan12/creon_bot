import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';

/**
 * Telegram кидает 400 ("message is not modified"), когда новый текст полностью совпадает
 * с уже показанным — например, две подряд невалидные попытки заполнения формы рендерят
 * один и тот же текст ошибки, или двойной тап по кнопке навигации/переключателя успевает
 * отправить два одинаковых edit до того, как Telegram отключит кнопку. Для пользователя
 * это не ошибка, а no-op, поэтому глушим именно её централизованно для всех
 * `ctx.editMessageText()`, а не в каждом месте вызова по отдельности.
 */
function isNotModifiedError(err: unknown): boolean {
  return err instanceof Error && /message is not modified/i.test(err.message);
}

type EditMessageText = BotContext['editMessageText'];

export function ignoreNotModifiedMiddleware(): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const original = ctx.editMessageText.bind(ctx) as EditMessageText;
    ctx.editMessageText = async (
      ...args: Parameters<EditMessageText>
    ): ReturnType<EditMessageText> => {
      try {
        return await original(...args);
      } catch (err) {
        if (isNotModifiedError(err)) return true;
        throw err;
      }
    };
    await next();
  };
}
