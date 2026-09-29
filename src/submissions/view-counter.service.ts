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

const TIMEOUT_MS = 10_000;

export interface VideoStats {
  views: number;
  /** null — площадка лайки не отдала (автор скрыл). */
  likes: number | null;
}

/**
 * Просмотры публикаций из открытого API площадки — пока только YouTube Data API (env YOUTUBE_API_KEY).
 * Остальные площадки открытого API с просмотрами чужих роликов не дают (VK video.get — только ключ
 * пользователя с правом video, которое выдаёт поддержка VK), там и без ключа или при сбое API
 * просмотры вводит модератор по ссылке.
 */
@Injectable()
export class ViewCounterService {
  private readonly logger = new Logger(ViewCounterService.name);
  private readonly youtubeKey?: string;

  constructor(config: ConfigService) {
    this.youtubeKey = config.get<string>('YOUTUBE_API_KEY') || undefined;
  }

  /** Считаем ли эту ссылку автоматически — тогда модератору не нужно вводить просмотры. */
  isAutomatic(url: string | null) {
    return (
      !!this.youtubeKey &&
      platformOf(url) === 'YOUTUBE' &&
      youtubeId(url!) !== null
    );
  }

  /** Просмотры и лайки по ссылкам; нет в карте — посчитать не удалось. */
  async fetchViews(urls: string[]): Promise<Map<string, VideoStats>> {
    const result = new Map<string, VideoStats>();
    const urlsById = new Map<string, string[]>();
    for (const url of urls) {
      if (!this.isAutomatic(url)) continue;
      const id = youtubeId(url)!;
      urlsById.set(id, [...(urlsById.get(id) ?? []), url]);
    }
    // До 50 роликов за запрос — это 1 единица из суточной квоты 10 000.
    for (const batch of chunks([...urlsById.keys()], 50)) {
      const data = await this.get<{
        items?: {
          id: string;
          statistics?: { viewCount?: string; likeCount?: string };
        }[];
      }>(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(',')}&key=${this.youtubeKey}`,
      );
      for (const item of data?.items ?? []) {
        const views = Number(item.statistics?.viewCount);
        if (!Number.isFinite(views)) continue;
        // автор может скрыть лайки — тогда likeCount нет
        const likes = Number(item.statistics?.likeCount ?? NaN);
        const stats = { views, likes: Number.isFinite(likes) ? likes : null };
        for (const url of urlsById.get(item.id) ?? []) result.set(url, stats);
      }
    }
    return result;
  }

  /** Сбой сети или API — не ошибка для вызывающего: просмотры введёт модератор. */
  private async get<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await res.json()) as T & { error?: { message?: string } };
      if (!res.ok || body.error) {
        // в адресе ключ — в лог только текст ошибки
        this.logger.warn(
          `API просмотров: ${body.error?.message ?? res.status}`,
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
