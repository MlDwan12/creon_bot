import type { VideoPlatform } from '@prisma/client';

/**
 * Площадки, где креаторы публикуют ролики: код → название и домены (с поддоменами). Коды — те же,
 * что в enum VideoPlatform (площадки заказа): satisfies не даст им разойтись.
 */
export const PLATFORMS = {
  TIKTOK: { name: 'TikTok', hosts: ['tiktok.com'] },
  YOUTUBE: { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  VK: { name: 'VK', hosts: ['vk.com', 'vk.ru', 'vkvideo.ru'] },
  INSTAGRAM: { name: 'Instagram', hosts: ['instagram.com'] },
  X: { name: 'X', hosts: ['x.com', 'twitter.com'] },
} as const satisfies Record<
  VideoPlatform,
  { name: string; hosts: readonly string[] }
>;

export type Platform = keyof typeof PLATFORMS | 'OTHER';

/** Ссылка ведёт на один из `hosts` (или его поддомен). */
export function isOnHosts(host: string, hosts: readonly string[]) {
  const h = host.toLowerCase();
  return hosts.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Площадка по ссылке на публикацию; не распознали — OTHER. */
export function platformOf(url: string | null): Platform {
  let host = '';
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    return 'OTHER';
  }
  const found = (Object.keys(PLATFORMS) as (keyof typeof PLATFORMS)[]).find(
    (p) => isOnHosts(host, PLATFORMS[p].hosts),
  );
  return found ?? 'OTHER';
}

/** id ролика YouTube: youtu.be/ID, watch?v=ID, /shorts/ID, /embed/ID, /live/ID. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // ?v= бывает и в ссылке другой площадки — без проверки домена чужой ролик заняли бы ей
  if (!isOnHosts(u.hostname, PLATFORMS.YOUTUBE.hosts)) return null;
  // ?v= — только у /watch: в /shorts/A?v=B или /redirect?…&v=B площадка покажет не B (или уведёт
  // с YouTube), а просмотры и «один ролик — одна оплата» считались бы по B. Два разных id — отказ.
  const v = u.searchParams.get('v');
  const id = isOnHosts(u.hostname, ['youtu.be'])
    ? u.pathname.split('/')[1]
    : u.pathname === '/watch'
      ? v
      : u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1];
  if (!id || (v !== null && v !== id)) return null;
  return /^[\w-]{11}$/.test(id) ? id : null;
}

/** id поста X: x.com/<автор>/status/ID, twitter.com/…/status/ID, x.com/i/status/ID. */
export function xPostId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isOnHosts(u.hostname, PLATFORMS.X.hosts)) return null;
  // без нулей впереди: «020» площадка может открыть как 20, а ключ ролика был бы другим
  return (
    u.pathname.match(/\/status(?:es)?\/([1-9]\d{0,19})(?:\/|$)/)?.[1] ?? null
  );
}

/**
 * id ролика TikTok: tiktok.com/@автор/video/ID, m.tiktok.com/v/ID.html.
 * Короткие vm.tiktok.com/… при сдаче раскрываются в полную ссылку (expandTiktokShortLink).
 */
export function tiktokVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isOnHosts(u.hostname, PLATFORMS.TIKTOK.hosts)) return null;
  return (
    u.pathname.match(
      /\/(?:video|v)\/([1-9]\d{4,24})(?:\.html)?(?:\/|$)/,
    )?.[1] ?? null
  );
}

/**
 * Ролик VK как «владелец_ролик» (как ждёт video.get): vk.com/video-1_2, vkvideo.ru/video1_2,
 * vk.com/clip-1_2 и ролик в просмотрщике — vk.com/feed?z=video-1_2%2F….
 */
export function vkVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isOnHosts(u.hostname, PLATFORMS.VK.hosts)) return null;
  // переход на чужой сайт через VK — не ролик, даже с z=video…
  if (/^\/away(?:\.php)?$/.test(u.pathname)) return null;
  // без нулей впереди: «video1_02» VK может открыть как 1_2, а ключ ролика был бы другим
  const re = /(?:video|clip)(-?[1-9]\d*_[1-9]\d*)(?!\d)/;
  const inPath = u.pathname.match(re)?.[1];
  const inZ = u.searchParams.get('z')?.match(re)?.[1];
  // ролик в адресе и другой в просмотрщике (z) — какой покажут, не угадать: отказ
  if (inPath && inZ && inPath !== inZ) return null;
  return inPath ?? inZ ?? null;
}

/**
 * Код публикации Instagram (shortcode): instagram.com/reel/КОД, /reels/КОД, /p/КОД, /tv/КОД,
 * в том числе с ником впереди (instagram.com/ник/reel/КОД).
 */
export function instagramShortcode(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isOnHosts(u.hostname, PLATFORMS.INSTAGRAM.hosts)) return null;
  return (
    u.pathname.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/)?.[1] ??
    null
  );
}

/** Короткая ссылка TikTok из «Поделиться»: vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…. */
export function isTiktokShortLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    isOnHosts(u.hostname, ['vm.tiktok.com', 'vt.tiktok.com']) ||
    (isOnHosts(u.hostname, PLATFORMS.TIKTOK.hosts) &&
      /^\/t\/\w+/.test(u.pathname))
  );
}

/**
 * Полная ссылка на ролик из короткой TikTok: идём по редиректам сами, только по https и доменам
 * TikTok и не больше 3 раз, пока в ссылке не появится id ролика. Метки (?_r=…) отбрасываем.
 * null — TikTok не ответил или увёл не на ролик: креатор пришлёт полную ссылку.
 */
export async function expandTiktokShortLink(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    let location: string | null;
    try {
      const res = await fetchFn(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel();
      location = res.headers.get('location');
    } catch {
      return null;
    }
    if (!location) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (
      next.protocol !== 'https:' ||
      !isOnHosts(next.hostname, PLATFORMS.TIKTOK.hosts)
    )
      return null;
    current = `${next.origin}${next.pathname}`;
    if (tiktokVideoId(current)) return current;
  }
  return null;
}

const VIDEO_IDS = [
  ['youtube', youtubeId],
  ['x', xPostId],
  ['tiktok', tiktokVideoId],
  ['instagram', instagramShortcode],
  ['vk', vkVideoId],
] as const;

/**
 * Ключ ролика по его id на площадке — чтобы тот же ролик не сдали дважды под разными ссылками:
 * ник в ссылке, его регистр, /p/ или /reel/, vk.com или vkvideo.ru ролик не меняют.
 * null — ссылка не на конкретный ролик (профиль, короткая vm.tiktok.com/… до раскрытия).
 */
export function videoIdKey(url: string): string | null {
  for (const [platform, idOf] of VIDEO_IDS) {
    const id = idOf(url);
    if (id) return `${platform}:${id}`;
  }
  return null;
}

/**
 * Ключ ролика для Submission.videoKey: по id (videoIdKey). Ссылки старых роликов, сданных до проверки
 * id, — домен без www/m и путь без хвостового «/» и параметров (у VK — с параметром z).
 */
export function videoKey(url: string): string {
  const key = videoIdKey(url);
  if (key) return key;
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  const z = isOnHosts(host, PLATFORMS.VK.hosts) && u.searchParams.get('z');
  return `${host}${path}${z ? `?z=${z}` : ''}`;
}

/** Автор публикации по данным API площадки — сверить с соцсетями в профиле креатора. */
export interface VideoAuthor {
  platform: 'YOUTUBE' | 'X';
  /** id канала YouTube или пользователя X. */
  id: string;
  /** @handle канала YouTube или username в X, без «@»; null — площадка не отдала. */
  handle: string | null;
  name: string | null;
}

/** Автор есть среди ссылок профиля: youtube.com/@handle, youtube.com/channel/<id>, x.com/<username>. */
export function authorInLinks(author: VideoAuthor, links: string[]): boolean {
  const handle = author.handle?.toLowerCase();
  return links.some((link) => {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      return false;
    }
    const [first, second] = u.pathname.split('/').filter(Boolean);
    if (author.platform === 'X')
      return (
        isOnHosts(u.hostname, PLATFORMS.X.hosts) &&
        !!handle &&
        first?.toLowerCase() === handle
      );
    return (
      isOnHosts(u.hostname, PLATFORMS.YOUTUBE.hosts) &&
      ((!!handle && first?.toLowerCase() === `@${handle}`) ||
        (first === 'channel' && second === author.id))
    );
  });
}

/** Страница автора на площадке — модератору открыть и сверить. */
export function authorUrl(author: VideoAuthor): string {
  if (author.platform === 'X')
    return author.handle
      ? `https://x.com/${author.handle}`
      : `https://x.com/i/user/${author.id}`;
  return author.handle
    ? `https://www.youtube.com/@${author.handle}`
    : `https://www.youtube.com/channel/${author.id}`;
}
