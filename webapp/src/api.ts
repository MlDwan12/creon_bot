import { i18next, setLang, type Lang } from './i18n';
import { createStore } from './store';
import { getInitData } from './telegram';
import {
  ApiError,
  REPORT_REASONS,
  createAccountApi,
  createAdvertiserApi,
  createCreatorApi,
  createModApi,
} from '@fixum/shared';
import type { OrderCategory, ReportTarget, Me } from '@fixum/shared';
// Типы ответов API и константы — общие с сайтом (packages/shared); здесь — запросы мини-аппа с initData.
export * from '@fixum/shared';

/** Аккаунт заблокирован — App.tsx показывает экран блокировки вместо любого экрана. */
export const banned = createStore<{
  reason: string | null;
  supportUrl: string | null;
} | null>(null);

export function categoryLabel(code: OrderCategory): string {
  return i18next.t(`categories.${code}`);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `tma ${getInitData()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let userMessage = i18next.t('common.genericError');
    const data = [400, 403, 404, 409, 429].includes(res.status)
      ? ((await res.json().catch(() => null)) as {
          message?: unknown;
          banned?: boolean;
          reason?: string | null;
          supportUrl?: string | null;
        } | null)
      : null;
    if (data) {
      if (typeof data?.message === 'string') userMessage = data.message;
      if (data?.banned)
        banned.set({
          reason: data.reason ?? null,
          supportUrl: data.supportUrl ?? null,
        });
    }
    throw new ApiError(res.status, userMessage, data);
  }
  return (await res.json()) as T;
}

const photos = new Map<number, Promise<string | null>>();

/**
 * Фото креатора из Telegram как blob-ссылка для <img>; null — фото нет или оно недоступно.
 * Через fetch, а не <img src>: картинке тоже нужен заголовок авторизации. Один запрос на запуск.
 */
export function fetchCreatorPhoto(id: number): Promise<string | null> {
  let photo = photos.get(id);
  if (!photo) {
    photo = fetch(`/api/creators/${id}/photo`, {
      headers: { Authorization: `tma ${getInitData()}` },
    })
      .then(async (res) =>
        res.ok ? URL.createObjectURL(await res.blob()) : null,
      )
      .catch(() => null);
    photos.set(id, photo);
  }
  return photo;
}

let me: Promise<Me> | undefined;

/** Один запрос на запуск: initData, а с ним и ответ, до перезапуска Mini App не меняется. */
/** Язык интерфейса и бота; null — снова по языку Telegram. */
/** Запомнить кабинет на сервере — тот же откроется на другом устройстве. */
export function updateCabinet(cabinet: 'creator' | 'advertiser') {
  me = undefined; // /api/me вернёт уже новый кабинет
  return request<{ ok: true }>('PUT', '/api/profile/cabinet', { cabinet });
}

export function updateLanguage(language: Lang | null) {
  me = undefined; // /api/me вернёт уже новый язык
  return request<{ ok: true }>('PUT', '/api/profile/language', { language });
}

export function fetchMe() {
  // неудачный запрос не запоминаем — иначе сбой сети считался бы ответом до перезапуска
  // язык с сервера главнее догадки при запуске (выбран в профиле, в т.ч. на другом устройстве) —
  // применяем при каждом ответе: экран профиля не покажет «Русский» при английском интерфейсе
  return (me ??= request<Me>('GET', '/api/me')
    .then((m) => {
      if (m.language !== i18next.language) setLang(m.language);
      return m;
    })
    .catch((err) => {
      me = undefined;
      throw err;
    }));
}

let rate: Promise<number | null> | undefined;

/** Курс USDT в рублях, один запрос на запуск; null — неизвестен (подсказку «≈ … ₽» не показываем). */
export function fetchRate() {
  return (rate ??= request<{ rub: number | null }>('GET', '/api/rate').then(
    (r) => r.rub,
    () => {
      rate = undefined;
      return null;
    },
  ));
}

export function reasonLabel(target: ReportTarget, code: string): string {
  return REPORT_REASONS[target].includes(code)
    ? i18next.t(`reportReasons.${target}.${code}`)
    : code;
}

// Запросы окна модератора — общие с сайтом (packages/shared/src/mod-api.ts), здесь — со входом мини-аппа.
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
  fetchModPayouts,
  decidePayout,
  finalizeVideo,
  markPublicationDeleted,
  approveReview,
  removeReview,
  fetchModReports,
  resolveReports,
  banUser,
  unbanUser,
} = createModApi(request);

// Запросы кабинета заказчика, поддержки и жалоб — общие с сайтом (packages/shared/src/advertiser-api.ts).
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
  rateVideo,
} = createAdvertiserApi(request);
export const { sendSupportMessage, createReport } = createAccountApi(request);

// Запросы кабинета креатора и профилей — общие с сайтом (packages/shared/src/creator-api.ts).
export const {
  fetchOpenOrders,
  fetchOrder,
  claimOrder,
  fetchMySubmissions,
  submitVideo,
  fetchBalance,
  requestPayout,
  fetchMyProfile,
  fetchCreator,
  updateProfileLinks,
  updateNotifications,
  updateWallet,
  fetchSocialAccounts,
  connectSocialAccount,
  disconnectSocialAccount,
} = createCreatorApi(request);
