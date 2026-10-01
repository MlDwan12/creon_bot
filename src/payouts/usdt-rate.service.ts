import { Injectable, Logger } from '@nestjs/common';

const RATE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub';
const TTL_MS = 60 * 60_000;
/** После сбоя — не чаще, чтобы не долбить CoinGecko (лимит бесплатного API). */
const RETRY_MS = 5 * 60_000;

/**
 * Курс USDT в рублях — только для наглядности рядом с суммами: деньги считаются в USDT.
 * Кэш в памяти на час; CoinGecko недоступен — отдаём прежний курс или null (клиент его скрывает).
 */
@Injectable()
export class UsdtRateService {
  private readonly logger = new Logger(UsdtRateService.name);
  private rub: number | null = null;
  private nextFetchAt = 0;
  private pending?: Promise<void>;

  async rubPerUsdt(): Promise<number | null> {
    if (Date.now() >= this.nextFetchAt)
      this.pending ??= this.refresh().finally(() => (this.pending = undefined));
    // устаревший курс отдаём сразу, обновление — в фоне
    if (this.rub === null) await this.pending;
    return this.rub;
  }

  private async refresh() {
    try {
      const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(5000) });
      const body = res.ok
        ? ((await res.json()) as { tether?: { rub?: unknown } })
        : undefined;
      const rub = body?.tether?.rub;
      if (typeof rub === 'number' && rub > 0) {
        this.rub = rub;
        this.nextFetchAt = Date.now() + TTL_MS;
        return;
      }
      this.logger.warn(`Курс USDT не получен: HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`Курс USDT не получен: ${String(err)}`);
    }
    this.nextFetchAt = Date.now() + RETRY_MS;
  }
}
