import type { ConfigService } from '@nestjs/config';
import type { Context, Telegraf } from 'telegraf';
import { TelegramError } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Воркер очереди уведомлений на настоящем Postgres: что отправлено, что удалено, что ждёт повтора.
 * Запуск — `yarn test:int`.
 */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );

const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const config = {
  get: (key: string) => (key === 'WEBAPP_URL' ? 'https://app' : '1'),
} as unknown as ConfigService;

/** Telegram, который отвечает по chat_id: 13 — бот заблокирован, 15 — 429, 16 — сеть упала. */
function setup() {
  const sent: string[] = [];
  const callApi = jest.fn((_method: string, payload: { chat_id: string }) => {
    const id = payload.chat_id;
    if (id === '13')
      throw new TelegramError({
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
    if (id === '15')
      throw new TelegramError({
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 30 },
      });
    if (id === '16') throw new Error('ETIMEDOUT');
    sent.push(id);
    return Promise.resolve({});
  });
  const bot = { telegram: { callApi } } as unknown as Telegraf<Context>;
  return { service: new NotificationsService(bot, prisma, config), sent };
}

/** Дождаться, пока запись в очередь (без await у вызывающего) дойдёт до базы. */
const flushWrites = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Notification", "Report", "Submission", "Order", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

it('отправляет по порядку; заблокированным не пишет; 403 — удалить, 429 и сбой — повторить позже', async () => {
  const { service, sent } = setup();
  await prisma.user.create({
    data: { telegramId: 12n, bannedAt: new Date() },
  });
  service.orderClosed({
    id: 1,
    title: 'Заказ',
    status: 'OPEN',
    submissions: [11, 12, 13, 14, 15, 16].map((id) => ({
      creator: { telegramId: BigInt(id) },
    })),
  } as never);
  await flushWrites();

  expect(await service.processBatch()).toBe(6);
  expect(sent).toEqual(['11', '14']);

  const left = await prisma.notification.findMany({ orderBy: { id: 'asc' } });
  expect(left.map((n) => [n.chatId, n.attempts])).toEqual([
    [15n, 0], // 429: попытка не тратится
    [16n, 1],
  ]);
  // повтор — не раньше, чем через паузу
  expect(left.every((n) => n.sendAfter > new Date(Date.now() + 20_000))).toBe(
    true,
  );
  expect(await service.processBatch()).toBe(0);
});

it('рассылка о новом заказе — всем, кроме автора, модераторов, заблокированных и отписавшихся; после обычных', async () => {
  const { service, sent } = setup();
  const author = await prisma.user.create({ data: { telegramId: 20n } });
  await prisma.user.createMany({
    data: [
      { telegramId: 1n }, // модератор
      { telegramId: 21n },
      { telegramId: 22n, bannedAt: new Date() },
      { telegramId: 23n, notifyNewOrders: false },
      { telegramId: 24n },
    ],
  });
  service.newOrderPublished({
    id: 7,
    title: 'Новый',
    advertiserId: author.id,
    cpmMinor: 100,
    minViews: 250,
  } as never);
  await flushWrites();
  service.reportResolved([30n], true);
  await flushWrites();

  await service.processBatch();
  expect(sent).toEqual(['30', '21', '24']);
});
