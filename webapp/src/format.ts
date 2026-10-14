import { PLATFORM_NAMES, type Platform, type VideoFormat } from './api';
import { i18next, locale } from './i18n';

/** «5 минут назад» / «5 minutes ago» — на текущем языке. */
const relative = () => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });

const DAY_MS = 24 * 60 * 60 * 1000;

/** «30 сентября». */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'long',
  });
}

/** «30 сентября · через 6 дн.» — для карточки заказа. */
export function formatDeadline(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
  return days > 0 ? `${formatDate(iso)} · ${i18next.t('time.inDays', { count: days })}` : formatDate(iso);
}

/** «2 часа назад», «вчера». */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 3600) return relative().format(Math.round(seconds / 60), 'minute');
  if (abs < 24 * 3600)
    return relative().format(Math.round(seconds / 3600), 'hour');
  return relative().format(Math.round(seconds / (24 * 3600)), 'day');
}

/** «12 500 USDT», центы — только если есть: «12,5 USDT». */
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString(locale(), { maximumFractionDigits: 2 })} USDT`;
}

/** «≈ 8 335 ₽» — подсказка по курсу рядом с суммой в USDT. */
export function approxRub(usdt: number, rubPerUsdt: number): string {
  return `≈ ${Math.round(usdt * rubPerUsdt).toLocaleString(locale())} ₽`;
}

/** «1,5 USDT за 1000 просмотров»; ставки ещё нет — до одобрения модератором. */
export function formatCpm(cpm: number | null): string {
  return cpm === null
    ? i18next.t('money.cpmPending')
    : `${formatMoney(cpm)} ${i18next.t('money.perThousand')}`;
}

/** «12 500». */
export function formatViews(views: number): string {
  return views.toLocaleString(locale());
}

/** «TikTok, Instagram · Вертикальное · 15–60 сек»; пусто — требований нет. */
export function formatVideoFormat(f: VideoFormat): string {
  const { minDurationSec: min, maxDurationSec: max } = f;
  const duration =
    min && max
      ? i18next.t('format.secRange', { min, max })
      : min
        ? i18next.t('format.secFrom', { min })
        : max
          ? i18next.t('format.secTo', { max })
          : '';
  const orientation =
    f.orientation === 'VERTICAL'
      ? i18next.t('format.vertical')
      : f.orientation === 'HORIZONTAL'
        ? i18next.t('format.horizontal')
        : '';
  return [formatPlatforms(f.platforms), orientation, duration].filter(Boolean).join(' · ');
}

/** «TikTok, Instagram»; пусто — любая площадка. */
export function formatPlatforms(platforms: VideoFormat['platforms']): string {
  return platforms.map((p) => PLATFORM_NAMES[p]).join(', ');
}

/** Сколько ждёт в очереди: «40 мин», «6 ч», «2 дн». */
export function waitingFor(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return i18next.t('time.minutesShort', { count: minutes });
  if (minutes < 24 * 60) return i18next.t('time.hoursShort', { count: Math.round(minutes / 60) });
  return i18next.t('time.daysShort', { count: Math.round(minutes / (24 * 60)) });
}

/** Ждёт дольше 4 часов — подсвечиваем в очереди модератора. */
export function isWaitingLong(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 4 * 60 * 60 * 1000;
}

// ponytail: копия доменов из src/common/platforms.ts — только для подсказки на экране; правильность
// ссылки всё равно проверяет бэкенд.
const PLATFORM_HOSTS: Record<Exclude<Platform, 'OTHER'>, string[]> = {
  TIKTOK: ['tiktok.com'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  VK: ['vk.com', 'vk.ru', 'vkvideo.ru'],
  INSTAGRAM: ['instagram.com'],
  X: ['x.com', 'twitter.com'],
};

/** Площадка и короткий вид ссылки («tiktok.com/@anya/video/7312…») — для карточки ролика; не ссылка — null. */
export function describeVideoUrl(url: string): { platform: Platform; short: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const platform =
    (Object.keys(PLATFORM_HOSTS) as Exclude<Platform, 'OTHER'>[]).find((p) =>
      PLATFORM_HOSTS[p].some((h) => host === h || host.endsWith(`.${h}`)),
    ) ?? 'OTHER';
  const full = `${host}${u.pathname.replace(/\/+$/, '')}`;
  return { platform, short: full.length > 34 ? `${full.slice(0, 33)}…` : full };
}
