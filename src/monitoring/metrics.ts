import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { NextFunction, Request, Response } from 'express';

/**
 * Метрики Fixum — по стандарту OpenTelemetry, отправка в Grafana Cloud (OTLP) раз в минуту.
 * Включаются переменными GRAFANA_OTLP_URL (адрес OTLP-шлюза стека, без /v1/metrics),
 * GRAFANA_OTLP_INSTANCE_ID и GRAFANA_OTLP_TOKEN; без них счётчики работают вхолостую и никуда
 * не уходят. Свой сервер мониторинга потом — только другой адрес, код тот же.
 *
 * В метках — только низкая кардинальность и никаких персональных данных: маршрут-шаблон
 * (/api/orders/:id, а не id), код ответа, площадка. Правила алертов — в MONITORING.md.
 */
const url = process.env.GRAFANA_OTLP_URL?.replace(/\/$/, '');
const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
const token = process.env.GRAFANA_OTLP_TOKEN;
const EXPORT_INTERVAL_MS = 60_000;

export const metricsEnabled = Boolean(url && instanceId && token);

const provider = new MeterProvider({
  resource: resourceFromAttributes({
    'service.name': 'fixum',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  }),
  readers: metricsEnabled
    ? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${url}/v1/metrics`,
            headers: {
              Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`,
            },
          }),
          exportIntervalMillis: EXPORT_INTERVAL_MS,
        }),
      ]
    : [],
});

/** Свой провайдер, не глобальный: глобальный OpenTelemetry занимает Sentry под свои трейсы. */
export const meter = provider.getMeter('fixum');

/** Дослать накопленное при остановке (редеплой) — иначе потеряется последняя минута. */
export function shutdownMetrics() {
  return provider.shutdown();
}

const httpRequests = meter.createCounter('fixum.http.requests', {
  description: 'Запросы к HTTP API по маршруту и коду ответа',
});
const httpDuration = meter.createHistogram('fixum.http.duration_ms', {
  description: 'Время ответа API, мс',
  advice: {
    explicitBucketBoundaries: [25, 50, 100, 250, 500, 1000, 2500, 5000],
  },
});

/**
 * Express-middleware: каждый ответ API — в счётчик и гистограмму. Маршрут — шаблон из роутера
 * (req.route), чтобы id в адресе не плодили отдельные ряды; статика мини-аппа не считается.
 */
export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/oauth')) {
    next();
    return;
  }
  const started = performance.now();
  res.on('finish', () => {
    const route =
      (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
    const attrs = { route, method: req.method, status: res.statusCode };
    httpRequests.add(1, attrs);
    httpDuration.record(performance.now() - started, { route });
  });
  next();
}

const externalApi = meter.createCounter('fixum.external_api.requests', {
  description:
    'Запросы к API площадок за просмотрами: outcome=ok|error по площадке',
});

/** Итог запроса к API площадки (YouTube, X, TikTok, VK, Instagram) — для алерта «API сбоит». */
export function recordExternalApi(platform: string, ok: boolean) {
  externalApi.add(1, { platform, outcome: ok ? 'ok' : 'error' });
}

/**
 * Получает ли бот сообщения: StartUpdate отмечает, что long polling запущен или остановлен.
 * Сама связь с Telegram — по проверке getMe в MonitoringService.
 */
let botPolling = false;
export function setBotPolling(running: boolean) {
  botPolling = running;
}
export function isBotPolling() {
  return botPolling;
}
