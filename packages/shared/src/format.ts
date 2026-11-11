import {
  type MySubmission,
  PLATFORM_NAMES,
  type Platform,
  type VideoFormat,
} from './api';

/**
 * Дата холда прошла, а итог ещё не подвели (его фиксирует модератор): вместо прошедшей даты
 * креатору пишем «проверяем публикацию».
 */
export function holdOverdue(holdEndsAt: string | null, now = Date.now()) {
  return holdEndsAt !== null && new Date(holdEndsAt).getTime() <= now;
}

/**
 * Калькулятор в форме заказа: на сколько просмотров хватит бюджета по обычной цене 1000 просмотров
 * в категории (с комиссией — как видит заказчик) и сколько это роликов, если каждый наберёт ровно
 * порог. Просмотры округлены вниз до сотен — это ориентир, не обещание; null — считать не из чего.
 */
export function orderEstimate(
  budget: number,
  per1000: number | null,
  minViews: number,
) {
  if (!per1000 || budget <= 0) return null;
  const views = Math.floor((budget / per1000) * 10) * 100;
  return { views, videos: minViews > 0 ? Math.floor(views / minViews) : 0 };
}

/** Срок проверки ролика модератором: креатор видит «решение до …», в очереди дольше — красным. */
export const REVIEW_SLA_HOURS = 24;

/** До когда модератор обещает решение по сданному ролику. */
export function reviewDueAt(submittedAt: string) {
  return new Date(
    new Date(submittedAt).getTime() + REVIEW_SLA_HOURS * 3600_000,
  ).toISOString();
}

/** Ждёт дольше срока проверки — просрочено. */
export function reviewOverdue(since: string, now = Date.now()) {
  return now - new Date(since).getTime() > REVIEW_SLA_HOURS * 3600_000;
}

/** Ролики в холде (одобрены, итога нет) — для списка в «Балансе», ближайшие к выводу первыми. */
export function heldVideos(subs: MySubmission[]) {
  return subs
    .filter((sub) => sub.holdEndsAt !== null)
    .sort((a, b) => a.holdEndsAt!.localeCompare(b.holdEndsAt!));
}

/** Перевод и локаль приложения: у мини-аппа и сайта свой экземпляр i18next, словари общие (i18n/). */
export interface Translator {
  t: (key: string, options?: Record<string, unknown>) => string;
  /** «ru-RU» / «en-US» — для чисел и дат. */
  locale: () => string;
}

/**
 * Форматирование чисел, денег, дат и требований к ролику — общее для мини-аппа и сайта.
 * Фабрика, потому что в общем пакете нет зависимостей: перевод передаёт приложение.
 */
export function createFormat({ t, locale }: Translator) {
  /** «5 минут назад» / «5 minutes ago» — на текущем языке. */
  const relative = () =>
    new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });

  const DAY_MS = 24 * 60 * 60 * 1000;

  /** «30 сентября». */
  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale(), {
      day: 'numeric',
      month: 'long',
    });
  }

  /** «5 ноября, 14:30». */
  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(locale(), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** «30 сентября · через 6 дн.» — для карточки заказа. */
  function formatDeadline(iso: string): string {
    const days = Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
    return days > 0
      ? `${formatDate(iso)} · ${t('time.inDays', { count: days })}`
      : formatDate(iso);
  }

  /** «2 часа назад», «вчера». */
  function timeAgo(iso: string): string {
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(seconds);
    if (abs < 3600)
      return relative().format(Math.round(seconds / 60), 'minute');
    if (abs < 24 * 3600)
      return relative().format(Math.round(seconds / 3600), 'hour');
    return relative().format(Math.round(seconds / (24 * 3600)), 'day');
  }

  /** «12 500 USDT», центы — только если есть: «12,5 USDT». */
  function formatMoney(amount: number): string {
    return `${amount.toLocaleString(locale(), { maximumFractionDigits: 2 })} USDT`;
  }

  /** «≈ 8 335 ₽» — подсказка по курсу рядом с суммой в USDT. */
  function approxRub(usdt: number, rubPerUsdt: number): string {
    return `≈ ${Math.round(usdt * rubPerUsdt).toLocaleString(locale())} ₽`;
  }

  /** «1,5 USDT за 1000 просмотров»; ставки ещё нет — до одобрения модератором. */
  function formatCpm(cpm: number | null): string {
    return cpm === null
      ? t('money.cpmPending')
      : `${formatMoney(cpm)} ${t('money.perThousand')}`;
  }

  /** «12 500». */
  function formatViews(views: number): string {
    return views.toLocaleString(locale());
  }

  /** Сколько просмотров оплатит сумма по ставке за 1000 — «≈ …», поэтому до сотен вниз. */
  function budgetViews(amount: number, cpm: number): number {
    return Math.floor((amount / cpm) * 10) * 100;
  }

  /** «TikTok, Instagram · Вертикальное · 15–60 сек»; пусто — требований нет. */
  function formatVideoFormat(f: VideoFormat): string {
    return videoFormatParts(f).join(' · ');
  }

  /** Те же требования к ролику по отдельности — для плашек: площадки, ориентация, длительность. */
  function videoFormatParts(f: VideoFormat): string[] {
    const { minDurationSec: min, maxDurationSec: max } = f;
    const duration =
      min && max
        ? t('format.secRange', { min, max })
        : min
          ? t('format.secFrom', { min })
          : max
            ? t('format.secTo', { max })
            : '';
    const orientation =
      f.orientation === 'VERTICAL'
        ? t('format.vertical')
        : f.orientation === 'HORIZONTAL'
          ? t('format.horizontal')
          : '';
    return [formatPlatforms(f.platforms), orientation, duration].filter(
      Boolean,
    );
  }

  /** Коротко для кнопок: 1 тыс., 50 тыс. (1K, 50K). */
  function formatCompact(n: number): string {
    return new Intl.NumberFormat(locale(), { notation: 'compact' }).format(n);
  }

  /** «TikTok, Instagram»; пусто — любая площадка. */
  function formatPlatforms(platforms: VideoFormat['platforms']): string {
    return platforms.map((p) => PLATFORM_NAMES[p]).join(', ');
  }

  /** Сколько ждёт в очереди: «40 мин», «6 ч», «2 дн». */
  function waitingFor(iso: string): string {
    const minutes = Math.max(
      0,
      Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
    );
    if (minutes < 60) return t('time.minutesShort', { count: minutes });
    if (minutes < 24 * 60)
      return t('time.hoursShort', { count: Math.round(minutes / 60) });
    return t('time.daysShort', {
      count: Math.round(minutes / (24 * 60)),
    });
  }

  /** Ждёт дольше 4 часов — подсвечиваем в очереди модератора. */
  function isWaitingLong(iso: string): boolean {
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
  function describeVideoUrl(
    url: string,
  ): { platform: Platform; short: string } | null {
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
    return {
      platform,
      short: full.length > 34 ? `${full.slice(0, 33)}…` : full,
    };
  }

  return {
    formatDate,
    formatDeadline,
    timeAgo,
    formatMoney,
    approxRub,
    formatCpm,
    formatViews,
    budgetViews,
    formatVideoFormat,
    videoFormatParts,
    formatCompact,
    formatPlatforms,
    formatDateTime,
    waitingFor,
    isWaitingLong,
    describeVideoUrl,
  };
}
