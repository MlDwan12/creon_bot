import type { BotContext } from '../interfaces/bot-context.interface';
import { MODERATOR_MENU_BUTTONS } from '../keyboards/menu.keyboard';
import { leaveSceneOnMenuMiddleware } from './leave-scene-on-menu.middleware';

async function run(text: string, inScene = true) {
  const editMessageText = jest.fn().mockResolvedValue(true);
  const next = jest.fn().mockResolvedValue(undefined);
  const session: Record<string, unknown> = inScene
    ? {
        __scenes: {
          current: 'order-reject',
          state: { orderId: 1, formMessageId: 42 },
          cursor: 1,
        },
      }
    : {};
  const ctx = {
    message: { text },
    chat: { id: 7 },
    session,
    telegram: { editMessageText },
  } as unknown as BotContext;
  await leaveSceneOnMenuMiddleware()(ctx, next);
  return { session, editMessageText, next };
}

describe('leaveSceneOnMenuMiddleware', () => {
  it('кнопка меню посреди формы: выходит из сцены, отменяет форму, пропускает дальше', async () => {
    const r = await run(MODERATOR_MENU_BUTTONS.ORDER_QUEUE);
    expect(r.session.__scenes).toBeUndefined();
    expect(r.editMessageText).toHaveBeenCalledWith(
      7,
      42,
      undefined,
      '✖️ Отменено.',
    );
    expect(r.next).toHaveBeenCalled();
  });

  it('/start тоже выходит из формы', async () => {
    const r = await run('/start');
    expect(r.session.__scenes).toBeUndefined();
  });

  it('обычный текст остаётся вводом в форму', async () => {
    const r = await run('Нет контактов в описании');
    expect(r.session.__scenes).toBeDefined();
    expect(r.editMessageText).not.toHaveBeenCalled();
    expect(r.next).toHaveBeenCalled();
  });

  it('вне формы ничего не трогает', async () => {
    const r = await run(MODERATOR_MENU_BUTTONS.ORDER_QUEUE, false);
    expect(r.editMessageText).not.toHaveBeenCalled();
    expect(r.next).toHaveBeenCalled();
  });
});
