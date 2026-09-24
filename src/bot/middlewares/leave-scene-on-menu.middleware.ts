import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import {
  MODERATOR_MENU_BUTTONS,
  USER_MENU_BUTTONS,
} from '../keyboards/menu.keyboard';

const MENU_TEXTS = new Set<string>([
  ...Object.values(USER_MENU_BUTTONS),
  ...Object.values(MODERATOR_MENU_BUTTONS),
]);

/**
 * Кнопка меню или /start посреди формы — это уход из неё, а не ввод. Сцены стоят в цепочке
 * раньше обработчиков меню и съели бы текст сами: визард отклонения принял бы
 * «🆕 Заказы на проверку» за причину и отклонил заказ. Поэтому выходим из сцены заранее,
 * помечаем форму отменённой и пропускаем апдейт дальше — к обработчику меню.
 */
export function leaveSceneOnMenuMiddleware(): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    const scenes = ctx.session?.__scenes;
    if (
      text &&
      scenes?.current &&
      (MENU_TEXTS.has(text) || /^\/start\b/.test(text))
    ) {
      const formMessageId = (
        scenes.state as { formMessageId?: number } | undefined
      )?.formMessageId;
      delete ctx.session.__scenes;
      if (formMessageId && ctx.chat) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            formMessageId,
            undefined,
            '✖️ Отменено.',
          );
        } catch {
          // сообщение формы уже могло исчезнуть
        }
      }
    }
    return next();
  };
}
