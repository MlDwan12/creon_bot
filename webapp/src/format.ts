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
/** «3 000 ₽ за видео» или «цена договорная». */
export function formatPrice(price: number | null): string {
  return price === null ? 'цена договорная' : `${price.toLocaleString('ru-RU')} ₽ за видео`;
}

/** Сколько ждёт в очереди: «40 мин», «6 ч», «2 дн». */
export function waitingFor(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ч`;
  return `${Math.round(minutes / (24 * 60))} дн`;
}

/** Ждёт дольше 4 часов — подсвечиваем в очереди модератора. */
export function isWaitingLong(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 4 * 60 * 60 * 1000;
}
