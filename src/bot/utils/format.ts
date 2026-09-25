import type { OrderCategory, User } from '@prisma/client';
import { stripContacts } from '../../common/contacts';

/** Уведомления уходят с parse_mode HTML — пользовательский текст экранировать перед подстановкой. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Merge HTML parse mode into a reply/edit extra options object (inline keyboard, etc). */
export function html<T extends object>(extra?: T): T & { parse_mode: 'HTML' } {
  return { ...(extra ?? ({} as T)), parse_mode: 'HTML' };
}

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

const ORDER_CATEGORY_LABELS: Record<OrderCategory, string> = Object.fromEntries(
  ORDER_CATEGORIES.map((c) => [c.code, c.label]),
) as Record<OrderCategory, string>;

export function orderCategoryLabel(category: OrderCategory): string {
  return ORDER_CATEGORY_LABELS[category];
}

export function formatDeadline(deadline: Date): string {
  return deadline.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** «3 000 ₽ за видео» или «цена договорная». */
export function formatPrice(price: number | null): string {
  return price === null
    ? 'цена договорная'
    : `${price.toLocaleString('ru-RU')} ₽ за видео`;
}

/**
 * Имя для другой стороны сделки — без @username: стороны общаются только через площадку,
 * чтобы не договаривались в обход неё. Контакты, вписанные в само имя («Аня @anya_ugc»), вырезаются.
 * creatorLabel (с username) — только модераторам и поддержке.
 */
export function publicName(user: User): string {
  return stripContacts(user.firstName ?? '') || 'Креатор';
}

export function creatorLabel(user: User): string {
  return user.username
    ? `@${user.username}`
    : (user.firstName ?? `id${user.telegramId}`);
}
