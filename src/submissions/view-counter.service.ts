import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { platformOf } from '../common/platforms';

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

/** id ролика VK в виде owner_video: vk.com/video-1_2, /clip-1_2, ?z=video-1_2, vkvideo.ru/video-1_2. */
export function vkVideoId(url: string): string | null {
  return (
    decodeURIComponent(url).match(/(?:video|clip)(-?\d+_\d+)/)?.[1] ?? null
  );
}

const TIMEOUT_MS = 10_000;

/**
 * Просмотры публикаций из открытых API площадок: YouTube Data API (env YOUTUBE_API_KEY) и VK API
 * (env VK_TOKEN). Для остальных площадок, без ключа или при сбое API — просмотров нет, их вводит
 * модератор по ссылке.
 */
@Injectable()
export class ViewCounterService {
  private readonly logger = new Logger(ViewCounterService.name);
  private readonly youtubeKey?: string;
  private readonly vkToken?: string;

  constructor(config: ConfigService) {
    this.youtubeKey = config.get<string>('YOUTUBE_API_KEY') || undefined;
    this.vkToken = config.get<string>('VK_TOKEN') || undefined;
  }

  /** Считаем ли эту ссылку автоматически — тогда модератору не нужно вводить просмотры. */
  isAutomatic(url: string | null) {
    const platform = platformOf(url);
    return (
      (platform === 'YOUTUBE' && !!this.youtubeKey && !!youtubeId(url!)) ||
      (platform === 'VK' && !!this.vkToken && !!vkVideoId(url!))
    );
  }

  /** Просмотры по ссылкам; нет в карте — посчитать не удалось. */
  async fetchViews(urls: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const youtube = new Map<string, string[]>();
    const vk = new Map<string, string[]>();
    for (const url of urls) {
      if (!this.isAutomatic(url)) continue;
      const [ids, id] =
        platformOf(url) === 'YOUTUBE'
          ? [youtube, youtubeId(url)!]
          : [vk, vkVideoId(url)!];
      ids.set(id, [...(ids.get(id) ?? []), url]);
    }
    const put = (ids: Map<string, string[]>, id: string, views: number) => {
      for (const url of ids.get(id) ?? []) result.set(url, views);
    };
    // YouTube отдаёт до 50 роликов за запрос — это 1 единица из суточной квоты 10 000.
    for (const batch of chunks([...youtube.keys()], 50)) {
      const data = await this.get<{
        items?: { id: string; statistics?: { viewCount?: string } }[];
      }>(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(',')}&key=${this.youtubeKey}`,
      );
      for (const item of data?.items ?? []) {
        const views = Number(item.statistics?.viewCount);
        if (Number.isFinite(views)) put(youtube, item.id, views);
      }
    }
    for (const batch of chunks([...vk.keys()], 100)) {
      const data = await this.get<{
        response?: {
          items?: { owner_id: number; id: number; views?: number }[];
        };
      }>(
        `https://api.vk.com/method/video.get?videos=${batch.join(',')}&access_token=${this.vkToken}&v=5.199`,
      );
      for (const item of data?.response?.items ?? []) {
        if (typeof item.views === 'number')
          put(vk, `${item.owner_id}_${item.id}`, item.views);
      }
    }
    return result;
  }

  /** Сбой сети или API — не ошибка для вызывающего: просмотры введёт модератор. */
  private async get<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await res.json()) as T & {
        error?: { message?: string; error_msg?: string };
      };
      if (!res.ok || body.error) {
        // в адресе ключ — в лог только текст ошибки
        this.logger.warn(
          `API просмотров: ${body.error?.message ?? body.error?.error_msg ?? res.status}`,
        );
        return null;
      }
      return body;
    } catch (err) {
      this.logger.warn(`API просмотров недоступно: ${String(err)}`);
      return null;
    }
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
