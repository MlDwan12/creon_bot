import type { ConfigService } from '@nestjs/config';
import type { Context } from 'telegraf';
import { devAllowList, devAllowed, devGate } from './dev-access';

const config = (env: Record<string, string>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('закрытый дев-стенд', () => {
  it('DEV_ALLOWED_IDS не задан — пускаем всех (прод)', () => {
    const list = devAllowList(config({ MODERATOR_IDS: '1' }));
    expect(list).toBeNull();
    expect(devAllowed(list, 999)).toBe(true);
  });

  it('задан — пускаем список и модераторов', () => {
    const list = devAllowList(
      config({ DEV_ALLOWED_IDS: '5, 6', MODERATOR_IDS: '1' }),
    );
    expect(devAllowed(list, 5)).toBe(true);
    expect(devAllowed(list, 1n)).toBe(true);
    expect(devAllowed(list, '6')).toBe(true);
    expect(devAllowed(list, 7)).toBe(false);
  });

  it('бот: чужому в личке — «тестовый стенд» без обработки; своим и группе поддержки — дальше', async () => {
    const gate = devGate(
      config({
        DEV_ALLOWED_IDS: '5',
        MODERATOR_IDS: '1',
        SUPPORT_CHAT_ID: '-100',
      }),
    );
    const run = async (fromId: number, chat: { id: number; type: string }) => {
      const reply = jest.fn(() => Promise.resolve());
      const next = jest.fn(() => Promise.resolve());
      await gate(
        {
          from: { id: fromId, language_code: 'ru' },
          chat,
          message: {},
          reply,
        } as unknown as Context,
        next,
      );
      return { reply, next };
    };

    const stranger = await run(7, { id: 7, type: 'private' });
    expect(stranger.next).not.toHaveBeenCalled();
    expect(stranger.reply).toHaveBeenCalledWith(
      'Это тестовый стенд Fixum — доступ только для команды.',
    );
    expect((await run(5, { id: 5, type: 'private' })).next).toHaveBeenCalled();
    expect(
      (await run(7, { id: -100, type: 'supergroup' })).next,
    ).toHaveBeenCalled();
  });
});
