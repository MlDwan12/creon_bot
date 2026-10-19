import type { Context, Telegraf } from 'telegraf';
import type { PrismaService } from '../prisma/prisma.service';
import { MonitoringService, withTimeout } from './monitoring.service';

// пачка показателей: перехватываем функцию сбора, gauge — просто его имя
let collect: (result: { observe: jest.Mock }) => Promise<void>;
jest.mock('./metrics', () => ({
  metricsEnabled: true,
  isBotPolling: () => true,
  shutdownMetrics: () => Promise.resolve(),
  meter: {
    createObservableGauge: (name: string) => name,
    addBatchObservableCallback: (cb: typeof collect) => (collect = cb),
  },
}));

describe('MonitoringService: сбор метрик', () => {
  const service = (prisma: unknown) => {
    const s = new MonitoringService(
      prisma as PrismaService,
      {} as Telegraf<Context>,
    );
    (s as unknown as { registerGauges(): void }).registerGauges();
    return s;
  };
  const observed = async () => {
    const result = { observe: jest.fn() };
    await collect(result);
    return new Map(
      result.observe.mock.calls.map((c: unknown[]) => [c[0], c[1]]),
    );
  };

  it('база упала — bot.up, память и диск всё равно отправляются, db.up = 0', async () => {
    const down = () => Promise.reject(new Error('connection refused'));
    service({
      notification: { aggregate: down },
      order: { count: down },
      submission: { count: down },
      payout: { count: down },
    });
    const m = await observed();
    expect(m.get('fixum.db.up')).toBe(0);
    expect(m.has('fixum.bot.up')).toBe(true);
    expect(m.has('fixum.memory.rss_bytes')).toBe(true);
    expect(m.has('fixum.disk.free_ratio')).toBe(true);
    expect(m.has('fixum.notifications.queue_size')).toBe(false);
  });

  it('withTimeout: зависший промис — ошибка по таймауту', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(
      'нет ответа за 10 мс',
    );
    await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
  });
});
