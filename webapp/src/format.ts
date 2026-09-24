const DAY_MS = 24 * 60 * 60 * 1000;
const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

/** «30 сентября». */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
}

/** «30 сентября · через 6 дн.» — для карточки заказа. */
export function formatDeadline(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
  return days > 0 ? `${formatDate(iso)} · через ${days} дн.` : formatDate(iso);
}

/** «2 часа назад», «вчера». */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 24 * 3600)
    return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / (24 * 3600)), 'day');
}

/** Цена в заказе — свободный текст рекламодателя; пустая — договорная. */
export function formatPrice(price: string | null): string {
  return price ?? 'цена договорная';
}
