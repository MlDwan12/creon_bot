import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { MonitoringService } from './monitoring.service';

/**
 * Мониторинг: ошибки в Sentry (фильтр отправляет только непредвиденные — 5xx, 4xx пропускает) и
 * метрики в Grafana Cloud (MonitoringService). Без SENTRY_DSN и настроек Grafana всё выключено —
 * поведение приложения не меняется. Подключение Sentry — src/monitoring/instrument.ts.
 */
@Module({
  imports: [SentryModule.forRoot()],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    MonitoringService,
  ],
})
export class MonitoringModule {}
