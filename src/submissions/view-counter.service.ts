import { MAX_VIEWS } from '../common/validation';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { platformOf, xPostId, youtubeId } from '../common/platforms';

const TIMEOUT_MS = 10_000;

export interface VideoStats {
  views: number;
  /** null — площадка лайки не отдала (автор скрыл). */
  likes: number | null;
}

/**
 * Просмотры публикаций из API площадок. Каждая площадка включается своим ключом в env:
 * YouTube — YOUTUBE_API_KEY (Data API), X — X_BEARER_TOKEN (API v2, оплата за чтение поста).
 * Ключа нет, ссылка не распознана или API не ответило — просмотры вводит модератор по ссылке,
 * поэтому новую площадку можно включить в любой момент, просто добавив ключ.
 * TikTok, Instagram и VK чужие просмотры без ключа самого креатора не отдают (нужно OAuth).
 */
@Injectable()
export class ViewCounterService {
  private readonly logger = new Logger(ViewCounterService.name);
  private readonly youtubeKey?: string;
  private readonly xToken?: string;

  constructor(config: ConfigService) {
    this.youtubeKey = config.get<string>('YOUTUBE_API_KEY') || undefined;
    this.xToken = config.get<string>('X_BEARER_TOKEN') || undefined;
  }

  /** Считаем ли эту ссылку автоматически — тогда модератору не нужно вводить просмотры. */
  isAutomatic(url: string | null) {
    if (!url) return false;
    return (
      // youtubeId берёт ?v= с любого домена — поэтому ещё и площадка по ссылке
      (!!this.youtubeKey &&
        platformOf(url) === 'YOUTUBE' &&
        youtubeId(url) !== null) ||
      (!!this.xToken && xPostId(url) !== null)
    );
  }

  /** Просмотры и лайки по ссылкам; нет в карте — посчитать не удалось. */
  async fetchViews(urls: string[]): Promise<Map<string, VideoStats>> {
    const result = new Map<string, VideoStats>();
    const auto = urls.filter((u) => this.isAutomatic(u));
    const youtube = byId(auto, youtubeId);
    const x = byId(auto, xPostId);
    if (this.youtubeKey) await this.fetchYoutube(youtube, result);
    if (this.xToken) await this.fetchX(x, result);
    return result;
  }

  private async fetchYoutube(
    urlsById: Map<string, string[]>,
    result: Map<string, VideoStats>,
  ) {
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
        const stats = toStats(
          item.statistics?.viewCount,
          item.statistics?.likeCount,
        );
        if (stats) setAll(result, urlsById.get(item.id), stats);
      }
    }
  }

  /**
   * Просмотры видео в посте — `public_metrics.view_count` вложенного видео (не показы поста:
   * impression_count считает и тех, кто видео не смотрел). Пост без видео — в карту не попадает.
   * Удалённые и скрытые посты X отдаёт в `errors` при ответе 200 — остальные посты из пачки считаем.
   */
  private async fetchX(
    urlsById: Map<string, string[]>,
    result: Map<string, VideoStats>,
  ) {
    // до 100 постов за запрос; платится каждый прочитанный пост
    for (const batch of chunks([...urlsById.keys()], 100)) {
      const data = await this.get<{
        data?: {
          id: string;
          public_metrics?: { like_count?: number };
          attachments?: { media_keys?: string[] };
        }[];
        includes?: {
          media?: {
            media_key: string;
            type: string;
            public_metrics?: { view_count?: number };
          }[];
        };
      }>(
        `https://api.x.com/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics&expansions=attachments.media_keys&media.fields=public_metrics,type`,
        { Authorization: `Bearer ${this.xToken}` },
      );
      const media = new Map(
        (data?.includes?.media ?? []).map((m) => [m.media_key, m]),
      );
      for (const post of data?.data ?? []) {
        const video = (post.attachments?.media_keys ?? [])
          .map((k) => media.get(k))
          .find((m) => m?.type === 'video' || m?.type === 'animated_gif');
        const stats = toStats(
          video?.public_metrics?.view_count,
          post.public_metrics?.like_count,
        );
        if (stats) setAll(result, urlsById.get(post.id), stats);
      }
    }
  }

  /** Сбой сети или API — не ошибка для вызывающего: просмотры введёт модератор. */
  private async get<T>(
    url: string,
    headers?: Record<string, string>,
  ): Promise<T | null> {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json()) as T & {
        error?: { message?: string }; // YouTube
        title?: string; // X
      };
      if (!res.ok) {
        // в адресе и заголовках ключ — в лог только текст ошибки
        this.logger.warn(
          `API просмотров: ${body.error?.message ?? body.title ?? res.status}`,
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

/** Ссылки по id ролика на площадке: одна публикация могла прийти разными ссылками. */
function byId(urls: string[], idOf: (url: string) => string | null) {
  const out = new Map<string, string[]>();
  for (const url of urls) {
    const id = idOf(url);
    if (id) out.set(id, [...(out.get(id) ?? []), url]);
  }
  return out;
}

/**
 * Колонки просмотров — Int4: больше MAX_VIEWS не пишем (такой ролик — всё равно выше любого
 * бюджета). Лайков нет (автор скрыл) — null; нет просмотров — посчитать не удалось.
 */
function toStats(
  views: string | number | undefined,
  likes: string | number | undefined,
): VideoStats | null {
  const v = Math.min(Number(views ?? NaN), MAX_VIEWS);
  if (!Number.isFinite(v)) return null;
  const l = Math.min(Number(likes ?? NaN), MAX_VIEWS);
  return { views: v, likes: Number.isFinite(l) ? l : null };
}

function setAll(
  result: Map<string, VideoStats>,
  urls: string[] | undefined,
  stats: VideoStats,
) {
  for (const url of urls ?? []) result.set(url, stats);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
