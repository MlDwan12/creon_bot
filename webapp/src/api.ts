import { i18next, setLang, type Lang } from './i18n';
import { createStore } from './store';
import { getInitData } from './telegram';
import { ApiError, REPORT_REASONS, createModApi } from '@fixum/shared';
import type {
  OrderCategory,
  OrderSummary,
  OrderDetail,
  MySubmission,
  MyOrder,
  NewOrderInput,
  VideoPlatform,
  OrderReport,
  Balance,
  CreatorProfile,
  Feedback,
  SocialAccount,
  ReportTarget,
  Me,
} from '@fixum/shared';
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

/**
 * Страница каталога. `after` — последний показанный заказ (без него — первая страница).
 * hasMore — есть ли следующая; total — для заголовка, может отставать на полминуты.
 */
export function fetchOpenOrders(
  after?: OrderSummary,
  category?: OrderCategory,
  platform?: VideoPlatform,
) {
  const query = new URLSearchParams();
  if (after) {
    query.set('afterId', String(after.id));
    query.set('afterCreatedAt', after.createdAt);
  }
  if (category) query.set('category', category);
  if (platform) query.set('platform', platform);
  return request<{
    items: OrderSummary[];
    hasMore: boolean;
    total: number;
    /** Только к первой странице: где есть открытые заказы (категории — с учётом площадки, и наоборот). */
    facets?: { categories: OrderCategory[]; platforms: VideoPlatform[] };
  }>('GET', `/api/orders?${query}`);
}

export function fetchOrder(id: number) {
  return request<OrderDetail>('GET', `/api/orders/${id}`);
}

export function claimOrder(id: number) {
  return request<{ submissionId: number }>('POST', `/api/orders/${id}/claim`);
}

export function fetchMySubmissions() {
  return request<MySubmission[]>('GET', '/api/submissions');
}

/**
 * Сдать ролик. `acceptPayout` — креатор согласился на остаток фонда, который показал ответ
 * 409 OVER_BUDGET (overBudgetOf): просмотры вышли за рамки бюджета.
 */
export function submitVideo(
  submissionId: number,
  videoUrl: string,
  views: number,
  acceptPayout?: number,
  /** Ссылка стоит в шапке профиля — если заказ этого требует (order.linkInBio). */
  bioLinkConfirmed?: boolean,
) {
  return request<{ ok: true }>(
    'POST',
    `/api/submissions/${submissionId}/video`,
    {
      videoUrl,
      views,
      acceptPayout,
      bioLinkConfirmed,
    },
  );
}

export function fetchMyOrders() {
  return request<MyOrder[]>('GET', '/api/my-orders');
}

/** Сколько обычно стоят 1000 просмотров в категории, USDT; null — мало данных. */
export function fetchPriceHint(category: OrderCategory) {
  return request<{ per1000: number | null }>(
    'GET',
    `/api/my-orders/price-hint?category=${category}`,
  );
}

export function createOrder(input: NewOrderInput) {
  return request<{ id: number }>('POST', '/api/my-orders', input);
}

/** Правка заказа. `deadlineDays` не передан — срок не меняется, null — без срока. */
export function updateOrder(
  id: number,
  input: Omit<NewOrderInput, 'deadlineDays'> & { deadlineDays?: number | null },
) {
  return request<{ ok: true }>('PUT', `/api/my-orders/${id}`, input);
}

export function closeOrder(id: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${id}/close`);
}

/** Продлить срок на `days` дней; истёкший заказ снова откроется. */
export function extendOrder(id: number, days: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${id}/extend`, { days });
}

export function deleteOrder(id: number) {
  return request<{ ok: true }>('DELETE', `/api/my-orders/${id}`);
}

export function fetchOrderReport(orderId: number) {
  return request<OrderReport>('GET', `/api/my-orders/${orderId}/report`);
}

/** Отчёт файлом CSV — придёт в чат с ботом. */
export function sendReportCsv(orderId: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${orderId}/report/csv`);
}

/** `onModeration` — отзыв с текстом ушёл на проверку и появится в профиле креатора после неё. */
export function rateVideo(submissionId: number, feedback: Feedback) {
  return request<{ ok: true; onModeration: boolean }>(
    'POST',
    `/api/submissions/${submissionId}/rate`,
    feedback,
  );
}

export function fetchMyProfile() {
  return request<CreatorProfile>('GET', '/api/profile');
}

export function fetchCreator(id: number) {
  return request<CreatorProfile>('GET', `/api/creators/${id}`);
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

export function updateProfileLinks(links: string[]) {
  return request<{ ok: true }>('PUT', '/api/profile/links', { links });
}

export function updateNotifications(newOrders: boolean) {
  return request<{ ok: true }>('PUT', '/api/profile/notifications', {
    newOrders,
  });
}

/** Пустая строка — убрать кошелёк. */
export function updateWallet(wallet: string) {
  return request<{ ok: true }>('PUT', '/api/profile/wallet', { wallet });
}

/** Пусто — ни одна площадка пока не подключается (нет ключей), раздел в профиле не показываем. */
export function fetchSocialAccounts() {
  return request<SocialAccount[]>('GET', '/api/accounts');
}

/** Ссылка на вход на площадке — открыть во внешнем браузере. */
export function connectSocialAccount(platform: SocialAccount['platform']) {
  return request<{ url: string }>(
    'POST',
    `/api/accounts/${platform.toLowerCase()}/connect`,
  );
}

export function disconnectSocialAccount(accountId: number) {
  return request<{ ok: true }>('DELETE', `/api/accounts/${accountId}`);
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

export function fetchBalance() {
  return request<Balance>('GET', '/api/balance');
}

export function requestPayout(amount: number) {
  return request<{ ok: true }>('POST', '/api/balance/withdraw', { amount });
}

export function reasonLabel(target: ReportTarget, code: string): string {
  return REPORT_REASONS[target].includes(code)
    ? i18next.t(`reportReasons.${target}.${code}`)
    : code;
}

/** Сообщение менеджеру из мини-аппа; ответ придёт в чат с ботом. */
export function sendSupportMessage(text: string) {
  return request<{ ok: true }>('POST', '/api/support', { text });
}

export function createReport(report: {
  target: ReportTarget;
  targetId: number;
  reason: string;
  comment: string;
}) {
  return request<{ ok: true }>('POST', '/api/reports', report);
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
