import * as Sentry from '@sentry/vue';
import type { App } from 'vue';

/**
 * Ошибки мини-аппа у пользователей — в Sentry: упавший экран в Telegram мы иначе не увидим, пока
 * человек сам не напишет. Адрес (DSN) задаётся при сборке — VITE_SENTRY_DSN; нет его — выключено.
 *
 * Персональные данные не отправляем (сервис зарубежный): ни пользователя, ни заголовков (в
 * Authorization — подписанные данные Telegram), ни тел, ни параметров адреса, ни записи экрана —
 * только ошибка, стектрейс и экран.
 */
/** Адрес без #…: там бывает подписанный initData (#tgWebAppData=…), если ошибка случилась до main.ts. */
const withoutHash = (url: unknown) =>
  typeof url === 'string' ? url.replace(/#.*$/, '') : url;

export function initMonitoring(app: App) {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    app,
    dsn,
    // стенд — по домену: fixumapp.com или dev.creon.couchreboot.site (сборка у них одна)
    environment: location.hostname,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.query_string;
        delete event.request.data;
        event.request.url = withoutHash(event.request.url) as string | undefined;
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      // в логах консоли и в адресах бывают данные пользователей — эти следы не отправляем
      if (crumb.category === 'console') return null;
      // переходы (from/to) и запросы (url) — без #…
      for (const key of ['from', 'to', 'url'])
        if (crumb.data?.[key]) crumb.data[key] = withoutHash(crumb.data[key]);
      return crumb;
    },
  });
}
