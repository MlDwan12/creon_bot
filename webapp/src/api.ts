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
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Ошибка API. `userMessage` — текст, который можно показать пользователю: только наши
 * 403/404 (их пишет бэкенд сам, как в боте). Остальное — общий текст, чтобы не светить внутренности.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
  ) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `tma ${getInitData()}` },
  });
  if (!res.ok) {
    let userMessage = 'Что-то пошло не так, попробуйте ещё раз';
    if (res.status === 403 || res.status === 404) {
      const body = (await res.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (typeof body?.message === 'string') userMessage = body.message;
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
