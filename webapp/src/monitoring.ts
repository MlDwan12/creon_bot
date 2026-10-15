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
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      // в логах консоли и в адресах бывают данные пользователей — эти следы не отправляем
      return crumb.category === 'console' ? null : crumb;
    },
  });
}
