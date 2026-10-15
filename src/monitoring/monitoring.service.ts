import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { OrderStatus, PayoutStatus, SubmissionStatus } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { readFile, statfs } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Context, Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import {
  isBotPolling,
  meter,
  metricsEnabled,
  shutdownMetrics,
} from './metrics';

/** Как часто проверять связь с Telegram (getMe). */
const TELEGRAM_CHECK_MS = 60_000;
/** Без удачной проверки дольше — бот считается отрезанным от Telegram. */
const TELEGRAM_STALE_MS = 3 * 60_000;

/**
 * Показатели, которые снимаются при каждой отправке метрик (раз в минуту): жив ли бот, очередь
 * уведомлений, бизнес-счётчики, диск, память, задержка цикла событий. Без настроек Grafana
 * (metricsEnabled) ничего не опрашивает — ни базу, ни Telegram.
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MonitoringService.name);
  private timer?: NodeJS.Timeout;
  private lastTelegramOk = 0;
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });

  constructor(
    private readonly prisma: PrismaService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  onModuleInit() {
    if (!metricsEnabled) return;
    this.loopDelay.enable();
    void this.checkTelegram();
    this.timer = setInterval(
      () => void this.checkTelegram(),
      TELEGRAM_CHECK_MS,
    );
    this.registerGauges();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    this.loopDelay.disable();
    await shutdownMetrics().catch((err) => this.logger.warn(err));
  }

  /** Связь с Telegram: getMe отвечает — токен жив и сеть до Telegram есть. */
  private async checkTelegram() {
    try {
      await this.bot.telegram.getMe();
      this.lastTelegramOk = Date.now();
    } catch (err) {
      this.logger.warn(`Telegram не отвечает: ${String(err)}`);
    }
  }

  private registerGauges() {
    const botUp = meter.createObservableGauge('fixum.bot.up', {
      description:
        '1 — бот получает сообщения: long polling запущен и Telegram отвечает',
    });
    const queueSize = meter.createObservableGauge(
      'fixum.notifications.queue_size',
      { description: 'Уведомлений в очереди' },
    );
    const queueAge = meter.createObservableGauge(
      'fixum.notifications.oldest_age_seconds',
      {
        description:
          'Сколько ждёт самое старое неотправленное уведомление (с постановки в очередь), с',
      },
    );
    const business = meter.createObservableGauge('fixum.business.count', {
      description:
        'Открытые заказы, ролики на модерации, заявки на вывод (kind=…)',
    });
    const diskFree = meter.createObservableGauge('fixum.disk.free_ratio', {
      description: 'Доля свободного места на диске сервера (0–1)',
    });
    const memoryUsed = meter.createObservableGauge('fixum.memory.rss_bytes', {
      description: 'Память процесса (RSS), байт',
    });
    const memoryLimit = meter.createObservableGauge(
      'fixum.memory.limit_bytes',
      { description: 'Лимит памяти контейнера (cgroup), байт' },
    );
    const loopDelay = meter.createObservableGauge(
      'fixum.event_loop.delay_p99_ms',
      { description: 'Задержка цикла событий Node, 99-й перцентиль, мс' },
    );

    meter.addBatchObservableCallback(
      async (result) => {
        result.observe(
          botUp,
          isBotPolling() && Date.now() - this.lastTelegramOk < TELEGRAM_STALE_MS
            ? 1
            : 0,
        );

        const [queue, open, onReview, payouts] = await Promise.all([
          // все неотправленные, включая отложенные после сбоев: возраст — от постановки в очередь
          this.prisma.notification.aggregate({
            _count: true,
            _min: { createdAt: true },
          }),
          this.prisma.order.count({ where: { status: OrderStatus.OPEN } }),
          this.prisma.submission.count({
            where: { status: SubmissionStatus.SUBMITTED },
          }),
          this.prisma.payout.count({
            where: { status: PayoutStatus.REQUESTED },
          }),
        ]);
        result.observe(queueSize, queue._count);
        result.observe(
          queueAge,
          queue._min.createdAt
            ? Math.max(0, (Date.now() - queue._min.createdAt.getTime()) / 1000)
            : 0,
        );
        result.observe(business, open, { kind: 'orders_open' });
        result.observe(business, onReview, { kind: 'videos_on_review' });
        result.observe(business, payouts, { kind: 'payouts_requested' });

        // контейнер видит диск сервера: его файловая система лежит на том же разделе
        const fs = await statfs('/');
        result.observe(diskFree, fs.bavail / fs.blocks);

        result.observe(memoryUsed, process.memoryUsage().rss);
        const limit = await cgroupMemoryLimit();
        if (limit) result.observe(memoryLimit, limit);

        result.observe(loopDelay, this.loopDelay.percentile(99) / 1e6);
        this.loopDelay.reset();
      },
      [
        botUp,
        queueSize,
        queueAge,
        business,
        diskFree,
        memoryUsed,
        memoryLimit,
        loopDelay,
      ],
    );
  }
}

/** Лимит памяти контейнера (cgroup v2); без лимита или вне Docker — null. */
async function cgroupMemoryLimit(): Promise<number | null> {
  try {
    const raw = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim();
    return raw === 'max' ? null : Number(raw);
  } catch {
    return null;
  }
}
