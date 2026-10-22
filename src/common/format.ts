import { tr } from '../i18n/request-lang';
import {
  type Order,
  OrderCategory,
  OrderStatus,
  type User,
} from '@prisma/client';
import { createHash } from 'node:crypto';

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

/** «3 000 USDT», центы — только если есть: «12,5 USDT». */
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`;
}

/** Код креатора без похожих I/1/O/0: по нему не узнать ни креатора, ни сколько их на площадке. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Имя креатора для рекламодателя — «Креатор А. · K7M2»: первая буква имени из Telegram и код по id,
 * один и тот же у креатора везде. Само имя не показываем: его никто не модерирует, а контакт в нём
 * («Аня тг anya», «＠anya», невидимые символы) фильтром не выловить. Стороны общаются только через площадку.
 * creatorLabel (с username) — только модераторам и поддержке.
 * ponytail: 4 символа кода — ~1 млн значений, у тысяч креаторов изредка совпадут; станет мешать — 5.
 */
export function publicName(user: Pick<User, 'id' | 'firstName'>): string {
  const hash = createHash('sha256').update(`creator:${user.id}`).digest();
  const code = [...hash.subarray(0, 4)]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('');
  const letter = (user.firstName ?? '')
    .normalize('NFKC')
    .match(/\p{L}/u)?.[0]
    ?.toUpperCase();
  return `${tr('errors.anonCreator')}${letter ? ` ${letter}.` : ''} · ${code}`;
}

export function creatorLabel(user: User): string {
  return user.username
    ? `@${user.username}`
    : (user.firstName ?? `id${user.telegramId}`);
}

/**
 * Название заказа видно креаторам, только если его проверил модератор. Изменённый заказ на проверке
 * или отклонённый после правки — новое название модератор не одобрил, в нём может быть контакт.
 */
export function titleVisibleToCreators(order: Pick<Order, 'status'>): boolean {
  return (
    order.status !== OrderStatus.PENDING_MODERATION &&
    order.status !== OrderStatus.REJECTED &&
    order.status !== OrderStatus.EDIT_REJECTED
  );
}
