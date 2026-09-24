/** Только то, что мы используем из официального telegram-web-app.js. Полный API: https://core.telegram.org/bots/webapps */
interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const webApp = window.Telegram?.WebApp;

/** SDK грузится и в обычном браузере, но initData есть только внутри Telegram. */
export const inTelegram = Boolean(webApp?.initData);

/** «Точно удалить?» — внутри Telegram его родным диалогом, в браузере — обычным confirm. */
export function confirmAction(message: string): Promise<boolean> {
  if (!inTelegram) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => webApp!.showConfirm(message, resolve));
}

/** Ссылку от пользователя делаем кликабельной только если это http(s) — не `javascript:` и прочее. */
export function safeUrl(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Подписанные Telegram данные о пользователе — ими авторизуется каждый запрос к API.
 * В обычном браузере их нет, поэтому в dev берём строку, подписанную скриптом
 * `scripts/dev-init-data.mjs`, из webapp/.env.local. В прод-сборку эта ветка не попадает.
 */
export function getInitData(): string {
  if (webApp?.initData) return webApp.initData;
  if (import.meta.env.DEV) return import.meta.env.VITE_DEV_INIT_DATA ?? '';
  return '';
}
