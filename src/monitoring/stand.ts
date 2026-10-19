/**
 * Стенд — домен мини-аппа (fixumapp.com, dev.creon.couchreboot.site): NODE_ENV в образе везде production.
 * Без побочных эффектов: метрики берут его, не подтягивая instrument.ts (тот читает .env и включает
 * Sentry — тестам это не нужно). Функция, а не константа: в dev .env читается уже после импорта.
 */
export function stand() {
  return URL.parse(process.env.WEBAPP_URL ?? '')?.hostname || 'local';
}
