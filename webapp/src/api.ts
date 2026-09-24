import { getInitData } from './telegram';

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
  price: string | null;
  category: OrderCategory;
  deadline: string | null;
  createdAt: string;
}

/** Ответ `GET /api/orders/:id`. */
export interface OrderDetail extends OrderSummary {
  claimed: boolean;
  /** Заказ текущего пользователя — откликнуться нельзя. */
  own: boolean;
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
    price: string | null;
    deadline: string | null;
    status: OrderStatus;
  };
}

/** Ответ `GET /api/my-orders` — см. src/api/my-orders.controller.ts. */
export interface MyOrder {
  id: number;
  title: string;
  description: string;
  price: string | null;
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
  price: string;
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
    attempt: number;
    submittedAt: string | null;
  }[];
}


/** Ответы `/api/mod/*` — см. src/api/moderation.controller.ts. */
export interface ModQueue {
  orders: { id: number; title: string; price: string | null; advertiser: string; createdAt: string }[];
  videos: { id: number; orderTitle: string; creator: string; submittedAt: string | null }[];
}

export interface ModStats {
  orders: { pending: number; open: number; rejected: number; closed: number; total: number };
  submissions: { pending: number; approved: number; rejected: number };
}

export interface ModOrderRow {
  id: number;
  title: string;
  price: string | null;
  status: OrderStatus;
  advertiser: string;
  submissionsCount: number;
  createdAt: string;
}

export interface ModOrder {
  id: number;
  title: string;
  description: string;
  price: string | null;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  moderatorComment: string | null;
  advertiser: string;
  createdAt: string;
}

export interface ModVideo {
  id: number;
  status: SubmissionStatus;
  videoUrl: string | null;
  submittedAt: string | null;
  creator: string;
  attempt: number;
  order: { id: number; title: string; description: string };
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
  method: 'GET' | 'POST' | 'DELETE',
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
      } | null;
      if (typeof data?.message === 'string') userMessage = data.message;
    }
    throw new ApiError(res.status, userMessage);
  }
  return (await res.json()) as T;
}

export function fetchOpenOrders(page: number, category?: OrderCategory) {
  const query = new URLSearchParams({ page: String(page) });
  if (category) query.set('category', category);
  return request<Page<OrderSummary>>('GET', `/api/orders?${query}`);
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

export function acceptVideo(submissionId: number) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/accept`);
}

export function rejectVideo(submissionId: number, comment: string) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/reject`, {
    comment,
  });
}

let me: Promise<{ isModerator: boolean; hasUsername: boolean }> | undefined;

/** Один запрос на запуск: initData, а с ним и ответ, до перезапуска Mini App не меняется. */
export function fetchMe() {
  return (me ??= request('GET', '/api/me'));
}

export function fetchModQueue() {
  return request<ModQueue>('GET', '/api/mod/queue');
}

export function fetchModStats() {
  return request<ModStats>('GET', '/api/mod/stats');
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
