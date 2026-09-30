import type { ConfigService } from '@nestjs/config';
import type { Order, User } from '@prisma/client';
import type { Context, Telegraf } from 'telegraf';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

function setup(bannedIds: bigint[] = []) {
  const sent: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sendMessage = jest.fn(async (chatId: string) => {
    await gate; // Telegram «думает», пока тест не отпустит
    if (chatId === '13')
      throw new Error('Forbidden: bot was blocked by the user');
    sent.push(chatId);
  });
  const bot = { telegram: { sendMessage } } as unknown as Telegraf<Context>;
  const prisma = {
    user: {
      findUnique: ({ where }: { where: { telegramId: bigint } }) =>
        Promise.resolve({
          bannedAt: bannedIds.includes(where.telegramId) ? new Date() : null,
        }),
    },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'WEBAPP_URL' ? 'https://app' : '1,2'),
  } as unknown as ConfigService;
  const service = new NotificationsService(bot, prisma, config);
  return { service, sent, release, sendMessage };
}

const order = (creators: number[]) =>
  ({
    id: 1,
    title: 'Заказ',
    submissions: creators.map((id) => ({
      creator: { telegramId: BigInt(id) },
    })),
  }) as unknown as Order & { submissions: { creator: User }[] };

describe('NotificationsService — очередь отправки', () => {
  it('не ждёт Telegram, шлёт по порядку, сбой одного не мешает остальным, заблокированным не пишет', async () => {
    const { service, sent, release, sendMessage } = setup([12n]);

    // метод вернулся, хотя Telegram ещё не ответил ни на одно сообщение
    service.orderClosed(order([11, 12, 13, 14]));
    expect(sent).toEqual([]);

    release();
    await service.onApplicationShutdown(); // дождаться очереди

    // 12 заблокирован — ему не отправляли; 13 заблокировал бота — ошибка не остановила 14
    expect(sendMessage.mock.calls.map(([id]) => id)).toEqual([
      '11',
      '13',
      '14',
    ]);
    expect(sent).toEqual(['11', '14']);
  });
});

describe('NotificationsService — название заказа креаторам', () => {
  it('непроверенное модератором название не уходит креатору — только номер', async () => {
    const { service, release, sendMessage } = setup();
    const pending = {
      ...order([11]),
      status: 'PENDING_MODERATION',
      title: 'пишите @shop',
    } as ReturnType<typeof order>;
    service.orderClosed(pending);
    service.orderClosed({ ...pending, status: 'OPEN' });
    release();
    await service.onApplicationShutdown();

    const texts = sendMessage.mock.calls.map((c) =>
      String((c as unknown[])[1]),
    );
    expect(texts[0]).toContain('Заказ #1 закрыт');
    expect(texts[0]).not.toContain('@shop');
    expect(texts[1]).toContain('«пишите @shop»');
  });
});
