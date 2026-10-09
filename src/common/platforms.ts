/** Площадки, где креаторы публикуют ролики: код → название и домены (с поддоменами). */
export const PLATFORMS = {
  TIKTOK: { name: 'TikTok', hosts: ['tiktok.com'] },
  YOUTUBE: { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  VK: { name: 'VK', hosts: ['vk.com', 'vk.ru', 'vkvideo.ru'] },
  INSTAGRAM: { name: 'Instagram', hosts: ['instagram.com'] },
  X: { name: 'X', hosts: ['x.com', 'twitter.com'] },
} as const;

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
  const id = u.hostname.toLowerCase().endsWith('youtu.be')
    ? u.pathname.slice(1)
    : (u.searchParams.get('v') ??
      u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]);
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * Ссылка на ролик в одном виде — чтобы тот же ролик не сдали дважды под разными ссылками.
 * YouTube — по id ролика (watch?v=, youtu.be, shorts — один ролик); остальное — домен без www/m
 * и путь без хвостового «/», без параметров (метки соцсетей вроде ?is_from_webapp ролик не меняют).
 * У VK ролик бывает в параметре z (vk.com/feed?z=video-1_2) — его оставляем.
 * ponytail: короткие ссылки (vm.tiktok.com/…) не раскрываем — нужен запрос к площадке.
 */
export function videoKey(url: string): string {
  const yt = youtubeId(url);
  if (yt) return `youtube:${yt}`;
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  const z = isOnHosts(host, PLATFORMS.VK.hosts) && u.searchParams.get('z');
  return `${host}${path}${z ? `?z=${z}` : ''}`;
}
