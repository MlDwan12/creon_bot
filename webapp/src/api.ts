import { ref } from 'vue';
import { getInitData } from './telegram';

/** Аккаунт заблокирован — App.vue показывает экран блокировки вместо любого экрана. */
export const banned = ref<{ reason: string | null; supportUrl: string | null } | null>(null);

export type OrderCategory =
  | 'PRODUCT_REVIEW'
  | 'BEAUTY'
  | 'FOOD'
  | 'FASHION'
  | 'GAMING'
  | 'FITNESS'
  | 'ENTERTAINMENT'
  | 'TECH'
  | 'OTHER';

// ponytail: копия ORDER_CATEGORIES из src/bot/utils/format.ts (там с эмодзи для чата) — фронт и бэк
// пока отдельные пакеты. Если копий станет больше, вынести общие типы в пакет, который импортируют оба.
export const ORDER_CATEGORIES: { code: OrderCategory; label: string }[] = [
  { code: 'PRODUCT_REVIEW', label: 'Обзор товара' },
  { code: 'BEAUTY', label: 'Красота' },
  { code: 'FOOD', label: 'Еда' },
  { code: 'FASHION', label: 'Мода' },
  { code: 'GAMING', label: 'Игры' },
  { code: 'FITNESS', label: 'Спорт и фитнес' },
  { code: 'ENTERTAINMENT', label: 'Развлечения' },
  { code: 'TECH', label: 'Техника' },
  { code: 'OTHER', label: 'Другое' },
];

export function categoryLabel(code: OrderCategory): string {
  return ORDER_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

/** Ответ `GET /api/orders` — см. OrdersController и OrdersService на бэкенде. */
export interface OrderSummary {
  id: number;
  title: string;
  description: string;
  price: number | null;
  category: OrderCategory;
  deadline: string | null;
  createdAt: string;
}

/** Ответ `GET /api/orders/:id`. */
export interface OrderDetail extends OrderSummary {
  claimed: boolean;
  /** Заказ текущего пользователя — откликнуться нельзя. */
  own: boolean;
  /** Сколько видео рекламодатель уже принял и отклонил. */
  advertiser: { accepted: number; rejected: number };
}

export type SubmissionStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'MODERATOR_APPROVED'
  | 'MODERATOR_REJECTED'
  | 'ADVERTISER_APPROVED'
  | 'ADVERTISER_REJECTED';

/** EXPIRED — закрыт по сроку (рекламодатель может продлить), CLOSED — закрыт им вручную. */
export type OrderStatus = 'PENDING_MODERATION' | 'OPEN' | 'REJECTED' | 'CLOSED' | 'EXPIRED';

/** Ответ `GET /api/submissions`: каждое видео — своя карточка. См. src/api/my-submissions.ts. */
export interface MySubmission {
  id: number;
  status: SubmissionStatus;
  /** Номер видео по этому заказу. */
  attempt: number;
  /** Самое новое видео по заказу — только по нему предлагаем прислать новое после отказа. */
  latest: boolean;
  videoUrl: string | null;
  comment: string | null;
  createdAt: string;
  order: {
    id: number;
    title: string;
    price: number | null;
    deadline: string | null;
    status: OrderStatus;
  };
}

/** Ответ `GET /api/my-orders` — см. src/api/my-orders.controller.ts. */
export interface MyOrder {
  id: number;
  title: string;
  description: string;
  price: number | null;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  rejectReason: string | null;
  submissionsCount: number;
  pendingDecision: number;
  /** Никто ещё не сдал видео — заказ можно удалить. */
  deletable: boolean;
  createdAt: string;
}

export interface NewOrderInput {
  title: string;
  description: string;
  /** Цена за видео, ₽; null — договорная. */
  price: number | null;
  category: OrderCategory;
  deadlineDays: number | null;
}

/** Ответ `GET /api/my-orders/:id/pending-videos`. */
export interface PendingVideos {
  order: { id: number; title: string };
  items: {
    id: number;
    videoUrl: string | null;
    creator: string;
    creatorId: number;
    attempt: number;
    submittedAt: string | null;
  }[];
}


/** Ответы `/api/mod/*` — см. src/api/moderation.controller.ts. */
export interface ModQueue {
  orders: {
    id: number;
    title: string;
    price: number | null;
    advertiser: string;
    createdAt: string;
    /** В тексте похоже на контакты для связи в обход площадки. */
    hasContacts: boolean;
  }[];
  videos: { id: number; orderTitle: string; creator: string; submittedAt: string | null }[];
}

export interface ModStats {
  orders: { pending: number; open: number; rejected: number; closed: number; total: number };
  submissions: { pending: number; approved: number; rejected: number };
}

export interface ModFunnel {
  orders: {
    created: number;
    published: number;
    rejected: number;
    withClaims: number;
    withVideos: number;
    withAccepted: number;
    /** Медиана от создания до решения модератора, часы; null — решений не было. */
    moderationHours: number | null;
  };
  videos: {
    submitted: number;
    pending: number;
    moderatorRejected: number;
    accepted: number;
    advertiserRejected: number;
  };
  users: { new: number; activeAdvertisers: number; activeCreators: number };
  /** Сумма цен принятых видео, ₽ (договорные не считаются) и сколько таких видео. */
  turnover: { rubles: number; acceptedPriced: number };
}

export interface ModOrderRow {
  id: number;
  title: string;
  price: number | null;
  status: OrderStatus;
  advertiser: string;
  submissionsCount: number;
  createdAt: string;
}

export interface ModOrder {
  id: number;
  title: string;
  description: string;
  price: number | null;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  moderatorComment: string | null;
  advertiser: string;
  createdAt: string;
  /** Фрагменты, похожие на контакты (@ник, t.me, телефон…) — см. src/common/contacts.ts. */
  contacts: string[];
}

export interface ModVideo {
  id: number;
  status: SubmissionStatus;
  videoUrl: string | null;
  submittedAt: string | null;
  creator: string;
  creatorId: number;
  attempt: number;
  order: { id: number; title: string; description: string };
}

/** Ссылки креатора на соцсети; null — не указана. */
export interface ProfileLinks {
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  vkUrl: string | null;
}

/** Профиль креатора — см. src/api/profiles.service.ts. */
export interface CreatorProfile {
  id: number;
  name: string;
  /** Средняя оценка 1–5; null — отзывов нет. */
  rating: number | null;
  reviewsCount: number;
  completed: number;
  /** Блокировка — приходит только модератору. */
  ban: { at: string; reason: string | null } | null;
  links: ProfileLinks;
  reviews: {
    submissionId: number;
    rating: number;
    review: string | null;
    orderTitle: string;
    decidedAt: string | null;
  }[];
  portfolio: { submissionId: number; videoUrl: string | null; orderTitle: string }[];
}

/** Оценка при приёмке видео. */
export interface Feedback {
  rating: number;
  review: string;
  portfolioAllowed: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Ошибка API. `userMessage` — текст, который можно показать пользователю: только наши
 * 400/403/404/429 (их тексты пишет бэкенд сам). Остальное — общий текст, чтобы не светить внутренности.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
  ) {
    super(`HTTP ${status}`);
  }
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
    let userMessage = 'Что-то пошло не так, попробуйте ещё раз';
    if ([400, 403, 404, 429].includes(res.status)) {
      const data = (await res.json().catch(() => null)) as {
        message?: unknown;
        banned?: boolean;
        reason?: string | null;
        supportUrl?: string | null;
      } | null;
      if (typeof data?.message === 'string') userMessage = data.message;
      if (data?.banned)
        banned.value = { reason: data.reason ?? null, supportUrl: data.supportUrl ?? null };
    }
    throw new ApiError(res.status, userMessage);
  }
  return (await res.json()) as T;
}

export function fetchOpenOrders(page: number, category?: OrderCategory) {
  const query = new URLSearchParams({ page: String(page) });
  if (category) query.set('category', category);
  // hasMore — есть ли следующая страница; total — для заголовка, может отставать на полминуты
  return request<Page<OrderSummary> & { hasMore: boolean }>('GET', `/api/orders?${query}`);
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

export function submitVideo(submissionId: number, videoUrl: string) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/video`, {
    videoUrl,
  });
}

export function fetchMyOrders() {
  return request<MyOrder[]>('GET', '/api/my-orders');
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

export function fetchPendingVideos(orderId: number) {
  return request<PendingVideos>('GET', `/api/my-orders/${orderId}/pending-videos`);
}

export function acceptVideo(submissionId: number, feedback: Feedback) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/accept`, feedback);
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
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    photos.set(id, photo);
  }
  return photo;
}

export function updateProfileLinks(links: ProfileLinks) {
  return request<{ ok: true }>('PUT', '/api/profile/links', links);
}

/** Модератор: удалить отзыв (оценку и текст). */
export function removeReview(submissionId: number) {
  return request<{ ok: true }>('DELETE', `/api/mod/reviews/${submissionId}`);
}

export function rejectVideo(submissionId: number, comment: string) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/reject`, {
    comment,
  });
}

type Me = { isModerator: boolean; supportUrl: string | null };
let me: Promise<Me> | undefined;

/** Один запрос на запуск: initData, а с ним и ответ, до перезапуска Mini App не меняется. */
export function fetchMe() {
  // неудачный запрос не запоминаем — иначе сбой сети считался бы ответом до перезапуска
  return (me ??= request<Me>('GET', '/api/me').catch((err) => {
    me = undefined;
    throw err;
  }));
}

export function fetchModQueue() {
  return request<ModQueue>('GET', '/api/mod/queue');
}

export function fetchModStats() {
  return request<ModStats>('GET', '/api/mod/stats');
}

/** Воронка за последние `days` дней; без аргумента — за всё время. См. src/api/analytics.service.ts. */
export function fetchModFunnel(days?: number) {
  return request<ModFunnel>('GET', `/api/mod/funnel${days ? `?days=${days}` : ''}`);
}

export function fetchAllOrders(page: number) {
  return request<Page<ModOrderRow>>('GET', `/api/mod/orders?page=${page}`);
}

export function fetchModOrder(id: number) {
  return request<ModOrder>('GET', `/api/mod/orders/${id}`);
}

export function moderateOrder(id: number, decision: 'approve' | 'reject', comment?: string) {
  return request<{ ok: true }>('POST', `/api/mod/orders/${id}/${decision}`, comment === undefined ? undefined : { comment });
}

export function fetchModVideo(id: number) {
  return request<ModVideo>('GET', `/api/mod/videos/${id}`);
}

export function moderateVideo(id: number, decision: 'approve' | 'reject', comment?: string) {
  return request<{ ok: true }>('POST', `/api/mod/videos/${id}/${decision}`, comment === undefined ? undefined : { comment });
}

/** На что жалоба: VIDEO и REVIEW — по id отклика, PROFILE — по id пользователя. */
export type ReportTarget = 'ORDER' | 'VIDEO' | 'REVIEW' | 'PROFILE';

/** Причины жалоб по типу объекта; коды проверяет бэкенд (src/api/reports.service.ts). */
export const REPORT_REASONS: Record<ReportTarget, { code: string; label: string }[]> = {
  ORDER: [
    { code: 'FRAUD', label: 'Мошенничество' },
    { code: 'PROHIBITED', label: 'Запрещённая тематика' },
    { code: 'FAKE_REVIEWS', label: 'Фейковые отзывы, обман покупателей' },
    { code: 'PERSONAL_DATA', label: 'Просят личные данные' },
    { code: 'SPAM', label: 'Спам' },
    { code: 'OFF_PLATFORM', label: 'Предлагает связь или оплату вне площадки' },
    { code: 'OTHER', label: 'Другое' },
  ],
  VIDEO: [
    { code: 'STOLEN', label: 'Чужое или краденое видео' },
    { code: 'UNAVAILABLE', label: 'Видео удалено или недоступно' },
    { code: 'BRAND_NEGATIVE', label: 'Негатив о бренде' },
    { code: 'BLACKMAIL', label: 'Шантаж, вымогательство' },
    { code: 'OFF_PLATFORM', label: 'Предлагает связь или оплату вне площадки' },
    { code: 'OTHER', label: 'Другое' },
  ],
  REVIEW: [
    { code: 'INSULT', label: 'Оскорбления' },
    { code: 'FALSE', label: 'Ложный отзыв' },
    { code: 'PERSONAL_DATA', label: 'Раскрывает личные данные' },
    { code: 'OFF_PLATFORM', label: 'Предлагает связь или оплату вне площадки' },
    { code: 'OTHER', label: 'Другое' },
  ],
  PROFILE: [
    { code: 'IMPERSONATION', label: 'Выдаёт себя за другого' },
    { code: 'OFFENSIVE', label: 'Оскорбительное имя или фото' },
    { code: 'OFF_PLATFORM', label: 'Предлагает связь или оплату вне площадки' },
    { code: 'OTHER', label: 'Другое' },
  ],
};

export function reasonLabel(target: ReportTarget, code: string): string {
  return REPORT_REASONS[target].find((r) => r.code === code)?.label ?? code;
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

/** Открытые жалобы на один объект — см. ReportsService.listOpen. */
export interface ModReportGroup {
  target: ReportTarget;
  targetId: number;
  /** null — объект уже удалён. */
  subject: {
    title: string;
    text: string | null;
    /** Кто отвечает за объект: автор заказа, видео, отзыва или владелец профиля. */
    author: string;
    authorId: number;
    /** Какой профиль креатора открыть (для заказа — нет). */
    profileId: number | null;
    orderId: number | null;
  } | null;
  reports: { id: number; reason: string; comment: string | null; reporter: string; createdAt: string }[];
}

export function fetchModReports() {
  return request<ModReportGroup[]>('GET', '/api/mod/reports');
}

/**
 * actioned — применить меру (закрыть заказ, убрать видео из портфолио, удалить отзыв, стереть ссылки).
 * banReason — ещё и заблокировать автора объекта.
 */
export function resolveReports(
  target: ReportTarget,
  targetId: number,
  actioned: boolean,
  banReason?: string,
) {
  return request<{ ok: true }>('POST', '/api/mod/reports/resolve', {
    target,
    targetId,
    actioned,
    banReason,
  });
}

export function banUser(userId: number, reason: string) {
  return request<{ ok: true }>('POST', `/api/mod/users/${userId}/ban`, { reason });
}

export function unbanUser(userId: number) {
  return request<{ ok: true }>('POST', `/api/mod/users/${userId}/unban`);
}
