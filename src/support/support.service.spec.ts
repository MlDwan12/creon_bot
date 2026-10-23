import type { ConfigService } from '@nestjs/config';
import type { Context, Telegraf } from 'telegraf';
import type { PrismaService } from '../prisma/prisma.service';
import { SupportService } from './support.service';

describe('лимит сообщений в поддержку', () => {
  const service = () =>
    new SupportService(
      {} as Telegraf<Context>,
      {} as PrismaService,
      { get: () => '-100' } as unknown as ConfigService,
    );
  const send = (s: SupportService, id: number, times: number) =>
    Array.from({ length: times }, () => s.allowMessage(id));

  it('один человек — не больше 5 в минуту', () => {
    expect(send(service(), 1, 6)).toEqual([
      ...Array<string>(5).fill('ok'),
      'flood',
    ]);
  });

  it('несколько аккаунтов вместе — не больше 15 в минуту на всю группу', () => {
    const s = service();
    for (const id of [1, 2, 3]) send(s, id, 5);
    expect(s.allowMessage(4)).toBe('busy');
  });

  it('флудер не съедает общий лимит', () => {
    const s = service();
    send(s, 1, 50);
    expect(s.allowMessage(2)).toBe('ok');
  });
});

describe('тема поддержки привязана к группе', () => {
  const user = {
    id: 1,
    telegramId: 111n,
    username: 'a',
    firstName: 'A',
    supportTopicId: 7,
    supportChatId: '-100old',
  };

  it('тема из прежней группы — новая тема в текущей, а не чужая с тем же номером', async () => {
    const sent: unknown[][] = [];
    const telegram = {
      reopenForumTopic: () => Promise.resolve(),
      createForumTopic: () => Promise.resolve({ message_thread_id: 42 }),
      sendMessage: (...args: unknown[]) => (sent.push(args), Promise.resolve()),
    };
    const update = jest.fn(() => Promise.resolve());
    const prisma = {
      user: { update },
      order: { count: () => Promise.resolve(0) },
      submission: { count: () => Promise.resolve(0) },
    };
    const s = new SupportService(
      { telegram } as unknown as Telegraf<Context>,
      prisma as unknown as PrismaService,
      { get: () => '-100new' } as unknown as ConfigService,
    );
    await s.fromApp(user as never, 'привет');
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { supportTopicId: 42, supportChatId: '-100new' },
    });
    const text = sent.find((a) => String(a[1]).includes('привет'));
    expect(text?.[2]).toMatchObject({ message_thread_id: 42 });
  });

  it('ответ в теме ищет пользователя только в текущей группе', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const s = new SupportService(
      {} as Telegraf<Context>,
      { user: { findFirst } } as unknown as PrismaService,
      { get: () => '-100new' } as unknown as ConfigService,
    );
    await s.fromSupport({
      message: {
        message_thread_id: 7,
        is_topic_message: true,
        from: { is_bot: false },
        text: 'ответ',
      },
    } as unknown as Context);
    expect(findFirst).toHaveBeenCalledWith({
      where: { supportChatId: '-100new', supportTopicId: 7 },
    });
  });
});
