import * as Sentry from '@sentry/nestjs';

/**
 * Sentry — ошибки бэкенда (5xx, упавшие фоновые задачи). Загружается первым в main.ts: Sentry
 * должен успеть обернуть модули до их импорта. Без SENTRY_DSN — выключен, ничего никуда не уходит.
 *
 * Персональные данные наружу не отправляем (сервис зарубежный): ни тела запросов, ни заголовков
 * (в Authorization — подписанные данные Telegram), ни IP, ни пользователя — только стектрейс и
 * маршрут. Ошибки 4xx (неверный ввод, нет прав) — не ошибки сервиса, их фильтр Sentry пропускает сам.
 */
// В dev переменные лежат в .env, а ConfigModule прочитает его позже; в проде их задаёт Docker
try {
  process.loadEnvFile();
} catch {
  // файла нет — значит, переменные уже в окружении
}

/** Стенд — домен мини-аппа (fixumapp.com, dev.creon.couchreboot.site): NODE_ENV в образе везде production. */
export const STAND =
  URL.parse(process.env.WEBAPP_URL ?? '')?.hostname || 'local';

const dsn = process.env.SENTRY_DSN;
if (dsn)
  Sentry.init({
    dsn,
    environment: STAND,
    // только ошибки: трейсы и профили не собираем
    tracesSampleRate: 0,
    // Sentry 11 по умолчанию собирает всё — выключаем всё, что может нести персональные данные
    // или секреты: пользователь, cookies, заголовки, тела, параметры адреса, значения переменных
    // в стектрейсе, данные запросов к базе
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
    beforeBreadcrumb(crumb) {
      // строки логов бывают с Telegram ID и текстами пользователей; запросы к Telegram API —
      // с токеном бота в адресе: такие следы не отправляем
      if (crumb.category === 'console') return null;
      return /api\.telegram\.org/.test(String(crumb.data?.url ?? ''))
        ? null
        : crumb;
    },
  });
