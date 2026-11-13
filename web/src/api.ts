import {
  ApiError,
  createAccountApi,
  createAdvertiserApi,
  createCreatorApi,
  createModApi,
  REPORT_REASONS,
  type Me,
  type OrderCategory,
  type PublicReport,
  type ReportTarget,
} from '@fixum/shared';
import { i18next, setLang } from './i18n';

export * from '@fixum/shared';

/** Действию нужен свежий вход (кошелёк, вывод) — событие на window, его слушает App.tsx. */
export const RELOGIN_EVENT = 'fixum:relogin';

/** Заявку «Стать заказчиком» отправили — меню (Shell.tsx) обновит метку «на рассмотрении». */
export const APPLIED_EVENT = 'fixum:applied';

/**
 * Запрос к API сайта. Вход — cookie сессии (ставит вход через Telegram или кодом), браузер шлёт её сам;
 * заголовок X-Fixum-Web без неё API не примет cookie — защита от подделки запросов с чужих сайтов.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Fixum-Web': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    // вход старше часа, а действие денежное — App.tsx предложит войти заново
    if (data?.relogin) window.dispatchEvent(new Event(RELOGIN_EVENT));
    throw new ApiError(
      res.status,
      typeof data?.message === 'string'
        ? data.message
        : i18next.t('common.genericError'),
      data,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Отчёт по публичной ссылке — без входа (src/orders/share.controller.ts); 404 — ссылку отозвали. */
export function fetchSharedReport(token: string) {
  return request<PublicReport>(
    'GET',
    `/api/share/${encodeURIComponent(token)}`,
  );
}

/** Кто вошёл; 401 — не вошёл, 403 с banned — заблокирован. */
export async function fetchMe() {
  const me = await request<Me>('GET', '/api/me');
  setLang(me.language);
  return me;
}

/** Настройки страницы входа; oidc — есть кнопка входа через Telegram. */
export function fetchWebConfig() {
  return request<{
    oidc: boolean;
    botUrl: string | null;
    privacyUrl: string | null;
    termsUrl: string | null;
  }>('GET', '/api/web/config');
}

/** Вход кодом из бота, шаг 1: одноразовая ссылка на бота. */
export function startCodeLogin() {
  return request<{ token: string; link: string }>(
    'POST',
    '/api/web/login/start',
  );
}

/** Шаг 2: код из Telegram — бэкенд ставит cookie сессии. */
export function codeLogin(token: string, code: string) {
  return request<void>('POST', '/api/web/login/code', { token, code });
}

export function logout() {
  return request<void>('POST', '/api/web/logout');
}

/** Запомнить кабинет на сервере — тот же откроется в мини-аппе и на другом устройстве. */
export function updateCabinet(cabinet: 'creator' | 'advertiser') {
  return request<{ ok: true }>('PUT', '/api/profile/cabinet', { cabinet });
}

/** Язык интерфейса и бота. */
export function updateLanguage(language: 'ru' | 'en') {
  return request<{ ok: true }>('PUT', '/api/profile/language', { language });
}

let rate: Promise<number | null> | undefined;

/** Курс USDT в рублях, один запрос на визит; null — неизвестен (подсказку «≈ … ₽» не показываем). */
export function fetchRate() {
  return (rate ??= request<{ rub: number | null }>('GET', '/api/rate').then(
    (r) => r.rub,
    () => {
      rate = undefined;
      return null;
    },
  ));
}

export function categoryLabel(code: OrderCategory): string {
  return i18next.t(`categories.${code}`);
}

export function reasonLabel(target: ReportTarget, code: string): string {
  return REPORT_REASONS[target].includes(code)
    ? i18next.t(`reportReasons.${target}.${code}`)
    : code;
}

// Запросы окна модератора — общие с мини-аппом (packages/shared/src/mod-api.ts)
export const {
  fetchModQueue,
  fetchModStats,
  fetchModFunnel,
  fetchWhatWorks,
  fetchModUsers,
  fetchUserHistory,
  fetchModMe,
  sendModActionsCsv,
  fetchAllOrders,
  fetchModOrder,
  moderateOrder,
  fetchModVideo,
  moderateVideo,
  finalizeVideo,
  markPublicationDeleted,
  fetchModPayouts,
  decidePayout,
  approveReview,
  removeReview,
  fetchModReports,
  resolveReports,
  banUser,
  unbanUser,
  eraseUser,
  approveApplication,
  decideLink,
  rejectApplication,
  openAdvertiser,
  closeAdvertiser,
} = createModApi(request);

/** Текст ошибки для экрана: наш ответ API — его текст, иначе общий. */
export function errorText(
  err: unknown,
  fallback = 'Не получилось, попробуйте ещё раз',
) {
  return err instanceof ApiError ? err.userMessage : fallback;
}

/** Ссылка от пользователя — только http(s), иначе не ссылка. */
export function safeUrl(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

// Кабинет заказчика, поддержка и жалобы — общие с мини-аппом (packages/shared/src/advertiser-api.ts)
export const {
  fetchMyOrders,
  fetchPriceHint,
  createOrder,
  updateOrder,
  closeOrder,
  extendOrder,
  deleteOrder,
  fetchOrderReport,
  sendReportCsv,
  fetchAdvertiserStats,
  sendStatsCsv,
  shareReport,
  unshareReport,
  rateVideo,
} = createAdvertiserApi(request);
export const { sendSupportMessage, createReport } = createAccountApi(request);

// Кабинет креатора и профили — общие с мини-аппом (packages/shared/src/creator-api.ts)
export const {
  fetchOpenOrders,
  fetchOrder,
  claimOrder,
  fetchMySubmissions,
  previewViews,
  submitVideo,
  fetchBalance,
  requestPayout,
  fetchMyProfile,
  applyAdvertiser,
  fetchCreator,
  updateProfileLinks,
  verifyProfileLink,
  markLessonSeen,
  updateNotifications,
  updateWallet,
  fetchSocialAccounts,
  disconnectSocialAccount,
} = createCreatorApi(request);

const photos = new Map<number, Promise<string | null>>();

/**
 * Фото пользователя из Telegram как blob-ссылка для <img>; null — фото нет или оно недоступно.
 * Через fetch, а не <img src>: без заголовка X-Fixum-Web API не примет cookie. Один запрос на визит.
 */
export function fetchCreatorPhoto(id: number): Promise<string | null> {
  let photo = photos.get(id);
  if (!photo) {
    photo = fetch(`/api/creators/${id}/photo`, {
      headers: { 'X-Fixum-Web': '1' },
    })
      .then(async (res) =>
        res.ok ? URL.createObjectURL(await res.blob()) : null,
      )
      .catch(() => null);
    photos.set(id, photo);
  }
  return photo;
}
