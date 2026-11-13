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
  /** Текст и подпись кнопки «Открыть» по chat_id — проверить язык. */
  const texts = new Map<string, { text: string; button: string }>();
  const callApi = jest.fn(
    (
      _method: string,
      payload: {
        chat_id: string;
        text: string;
        reply_markup?: { inline_keyboard: { text: string }[][] };
      },
    ) => {
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
      texts.set(id, {
        text: payload.text,
        button: payload.reply_markup?.inline_keyboard[0][0].text ?? '',
      });
      return Promise.resolve({});
    },
  );
  const bot = { telegram: { callApi } } as unknown as Telegraf<Context>;
  return {
    service: new NotificationsService(bot, prisma, config),
    sent,
    texts,
  };
}

/** Дождаться, пока запись в очередь (без await у вызывающего) дойдёт до базы. */
const flushWrites = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Notification", "Report", "Submission", "Order", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

const openOrder = (advertiserId: number, title: string) =>
  prisma.order.create({
    data: {
      advertiserId,
      title,
      description: 'd',
      budgetMinor: 10000,
      feePercent: 10,
      cpmMinor: 100,
      status: 'OPEN',
    },
  });

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
  const { service, sent, texts } = setup();
  const author = await prisma.user.create({ data: { telegramId: 20n } });
  await prisma.user.createMany({
    data: [
      { telegramId: 1n }, // модератор
      { telegramId: 21n, telegramLanguage: 'ru' },
      { telegramId: 22n, bannedAt: new Date() },
      { telegramId: 23n, notifyNewOrders: false },
      // Telegram на русском, но в профиле выбран английский
      { telegramId: 24n, telegramLanguage: 'ru', language: 'en' },
      { telegramId: 30n, telegramLanguage: 'ru' }, // жаловался
    ],
  });
  service.newOrderPublished(await openOrder(author.id, 'Новый'));
  await flushWrites();
  await service.reportResolved([30n], true);
  await flushWrites();

  await service.processBatch();
  // сначала обычное (ответ на жалобу), потом рассылка — её порядок внутри не важен
  expect(sent[0]).toBe('30');
  expect(sent.slice(1).sort()).toEqual(['21', '24', '30']);
  expect(texts.get('21')).toMatchObject({ button: 'Открыть' });
  expect(texts.get('21')!.text).toContain('Новый заказ: «Новый»');
  expect(texts.get('24')).toMatchObject({ button: 'Open' });
  expect(texts.get('24')!.text).toContain('New order: “Новый”');
});

it('рассылку о заказе, который сняли, пока она ждала в очереди, не отправляет', async () => {
  const { service, sent } = setup();
  const author = await prisma.user.create({ data: { telegramId: 20n } });
  await prisma.user.create({ data: { telegramId: 21n } });
  const order = await openOrder(author.id, 'Снятый');
  service.newOrderPublished(order);
  await flushWrites();
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'REJECTED' },
  });

  await service.processBatch();
  expect(sent).toEqual([]);
  expect(await prisma.notification.count()).toBe(0);
});

describe('карточка ролика виджетом (WIDGETS_ENABLED)', () => {
  /** Telegram, который запоминает вызовы; editMessageWidgetData падает, если editFails. */
  function widgetSetup(widgets: boolean, editFails = false) {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const callApi = jest.fn(
      (method: string, payload: Record<string, unknown>) => {
        calls.push({ method, payload });
        if (method === 'editMessageWidgetData' && editFails)
          throw new TelegramError({
            error_code: 400,
            description: 'Bad Request: message to edit not found',
          });
        return Promise.resolve(
          method === 'sendWidget' ? { message_id: 500 } : {},
        );
      },
    );
    const bot = { telegram: { callApi } } as unknown as Telegraf<Context>;
    const cfg = {
      get: (key: string) =>
        key === 'WEBAPP_URL'
          ? 'https://app'
          : key === 'WIDGETS_ENABLED'
            ? String(widgets)
            : '1',
    } as unknown as ConfigService;
    return { service: new NotificationsService(bot, prisma, cfg), calls };
  }

  async function submitted() {
    const advertiser = await prisma.user.create({
      data: { telegramId: 20n },
    });
    const creator = await prisma.user.create({
      data: { telegramId: 21n, language: 'ru' },
    });
    const order = await openOrder(advertiser.id, 'Обзор наушников');
    const sub = await prisma.submission.create({
      data: {
        orderId: order.id,
        creatorId: creator.id,
        status: 'SUBMITTED',
        videoUrl: 'https://www.tiktok.com/@a/video/1',
        views: 12400,
        payoutMinor: 1000,
        submittedAt: new Date(),
      },
    });
    return { advertiser, creator, order, sub };
  }

  /** Методы, вызванные для чата креатора (21). */
  const toCreator = (
    calls: { method: string; payload: Record<string, unknown> }[],
  ) => calls.filter((c) => c.payload.chat_id === '21').map((c) => c.method);

  const chatData = (payload: Record<string, unknown>) =>
    JSON.parse(payload.chat_data as string) as Record<string, string>;

  it('сдача — карточка без пинга; одобрение — правка карточки и пинг ответом на неё', async () => {
    const { service, calls } = widgetSetup(true);
    const { advertiser, creator, order, sub } = await submitted();
    service.videoSubmitted({ ...sub, order, creator });
    await flushWrites();
    await service.processBatch();

    // креатору — только карточка (модератору, чат 1 из MODERATOR_IDS, — его текст, как раньше)
    expect(toCreator(calls)).toEqual(['sendWidget']);
    const widget = calls.find((c) => c.method === 'sendWidget')!;
    expect(chatData(widget.payload)).toMatchObject({
      s: 'review',
      t: '«Обзор наушников»',
      p: 'TikTok',
    });
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } }))
        .widgetMessageId,
    ).toBe(500);

    calls.length = 0;
    const approved = await prisma.submission.update({
      where: { id: sub.id },
      data: {
        status: 'MODERATOR_APPROVED',
        payoutMinor: 2480,
        decidedAt: new Date(),
      },
    });
    service.videoApprovedByModerator({
      ...approved,
      order: { ...order, advertiser },
      creator,
    });
    await flushWrites();
    await service.processBatch();

    const edit = calls.find((c) => c.method === 'editMessageWidgetData')!;
    expect(edit.payload).toMatchObject({ chat_id: '21', message_id: 500 });
    expect(chatData(edit.payload)).toMatchObject({ s: 'hold', a: '24,8 USDT' });
    const ping = calls.find(
      (c) => c.method === 'sendMessage' && c.payload.chat_id === '21',
    )!;
    expect(ping.payload.text).toBe('✅ Ролик одобрен — начислено 24,8 USDT');
    expect(ping.payload.reply_parameters).toMatchObject({ message_id: 500 });
    // заказчику — как раньше, текстом
    expect(
      calls.some(
        (c) => c.method === 'sendMessage' && c.payload.chat_id === '20',
      ),
    ).toBe(true);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('карточку удалили из чата — полный текст, следующее событие пришлёт новую', async () => {
    const { service, calls } = widgetSetup(true, true);
    const { order, creator, sub } = await submitted();
    const rejected = await prisma.submission.update({
      where: { id: sub.id },
      data: {
        status: 'MODERATOR_REJECTED',
        moderatorComment: 'Нет ссылки',
        widgetMessageId: 77,
      },
    });
    service.videoRejectedByModerator(
      { ...rejected, order, creator },
      'Нет ссылки',
    );
    await flushWrites();
    await service.processBatch();

    expect(calls.map((c) => c.method)).toEqual([
      'editMessageWidgetData',
      'sendMessage',
    ]);
    expect(calls[1].payload.text).toContain('Причина: Нет ссылки');
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } }))
        .widgetMessageId,
    ).toBeNull();
  });

  it('виджеты выключены — карточки нет, тексты как раньше', async () => {
    const { service, calls } = widgetSetup(false);
    const { order, creator, sub } = await submitted();
    service.videoSubmitted({ ...sub, order, creator });
    service.viewsFinalized({ ...sub, order, creator });
    await flushWrites();
    await service.processBatch();

    expect(toCreator(calls)).toEqual(['sendMessage']);
    expect(
      calls.find((c) => c.payload.chat_id === '21')!.payload.text,
    ).toContain('Холд по ролику');
  });
});
