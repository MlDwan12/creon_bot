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
