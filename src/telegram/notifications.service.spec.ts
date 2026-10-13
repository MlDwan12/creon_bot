import type { ConfigService } from '@nestjs/config';
import type { Notification, Order, User } from '@prisma/client';
import type { Context, Telegraf } from 'telegraf';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/** Сервис, который вместо базы складывает строки очереди в массив. */
function setup() {
  const queued: Partial<Notification>[] = [];
  const prisma = {
    notification: {
      createMany: ({ data }: { data: Partial<Notification>[] }) => {
        queued.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'WEBAPP_URL' ? 'https://app' : '1,2'),
  } as unknown as ConfigService;
  const service = new NotificationsService(
    {} as Telegraf<Context>,
    prisma,
    config,
  );
  return { service, queued };
}

const order = (creators: number[]) =>
  ({
    id: 1,
    title: 'Заказ',
    submissions: creators.map((id) => ({
      creator: { telegramId: BigInt(id) },
    })),
  }) as unknown as Order & { submissions: { creator: User }[] };

describe('NotificationsService — очередь', () => {
  it('каждому креатору одно сообщение, даже если откликов несколько', () => {
    const { service, queued } = setup();
    service.orderClosed(order([11, 12, 11]));
    expect(queued.map((n) => n.chatId)).toEqual([11n, 12n]);
  });

  it('модераторам — каждому из MODERATOR_IDS', () => {
    const { service, queued } = setup();
    service.reportCreated('заказ «X»');
    expect(queued.map((n) => n.chatId)).toEqual([1n, 2n]);
  });
});

describe('NotificationsService — название заказа креаторам', () => {
  it('непроверенное модератором название не уходит креатору — только номер', () => {
    const { service, queued } = setup();
    const pending = {
      ...order([11]),
      status: 'PENDING_MODERATION',
      title: 'пишите @shop',
    } as ReturnType<typeof order>;
    service.orderClosed(pending);
    service.orderClosed({ ...pending, status: 'OPEN' });

    expect(queued[0].text).toContain('Заказ #1 закрыт');
    expect(queued[0].text).not.toContain('@shop');
    expect(queued[1].text).toContain('«пишите @shop»');
  });
});
