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

// ponytail: копия ORDER_CATEGORIES из src/bot/utils/format.ts — фронт и бэк пока отдельные
// пакеты. Если копий станет больше, вынести общие типы в пакет, который импортируют оба.
export const ORDER_CATEGORIES: { code: OrderCategory; label: string }[] = [
  { code: 'PRODUCT_REVIEW', label: '📦 Обзор товара' },
  { code: 'BEAUTY', label: '💄 Красота' },
  { code: 'FOOD', label: '🍔 Еда' },
  { code: 'FASHION', label: '👗 Мода' },
  { code: 'GAMING', label: '🎮 Игры' },
  { code: 'FITNESS', label: '🏋️ Спорт и фитнес' },
  { code: 'ENTERTAINMENT', label: '🎵 Развлечения' },
  { code: 'TECH', label: '💻 Техника' },
  { code: 'OTHER', label: '🗂 Другое' },
];

export function categoryLabel(code: OrderCategory): string {
  return ORDER_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

/** Ответ `GET /api/orders` — см. OrdersController и OrdersService.listOpen на бэкенде. */
export interface OrderSummary {
  id: number;
  title: string;
  description: string;
  price: string | null;
  category: OrderCategory;
  deadline: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `tma ${getInitData()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function fetchOpenOrders(page: number, category?: OrderCategory) {
  const query = new URLSearchParams({ page: String(page) });
  if (category) query.set('category', category);
  return get<Page<OrderSummary>>(`/api/orders?${query}`);
}
