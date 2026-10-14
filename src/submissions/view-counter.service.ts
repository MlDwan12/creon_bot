import { recordExternalApi } from '../monitoring/metrics';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialPlatform } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { chunks, toStats, type VideoStats } from '../accounts/providers';
import { platformOf, xPostId, youtubeId } from '../common/platforms';

export type { VideoStats } from '../accounts/providers';

const TIMEOUT_MS = 10_000;

/** Ролик и его автор: TikTok, VK и Instagram отдают просмотры только по токену самого креатора. */
export interface VideoRef {
  url: string;
  creatorId: number;
}

/**
 * Просмотры публикаций из API площадок. Каждая площадка включается своим ключом в env:
 * YouTube — YOUTUBE_API_KEY (Data API), X — X_BEARER_TOKEN (API v2, оплата за чтение поста),
 * TikTok, VK и Instagram — ключами приложения (src/accounts) и аккаунтами, которые креатор подключил в профиле.
 * Ключа нет, аккаунт не подключён, ссылка не распознана или API не ответило — просмотры вводит
 * модератор по ссылке, поэтому площадку можно включить в любой момент, просто добавив ключи.
 */
@Injectable()
export class ViewCounterService {
  private readonly logger = new Logger(ViewCounterService.name);
  private readonly youtubeKey?: string;
  private readonly xToken?: string;

  constructor(
    config: ConfigService,
    private readonly accounts: AccountsService,
  ) {
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
      (!!this.xToken && xPostId(url) !== null) ||
      // креатор мог и не подключить аккаунт — тогда fetchViews ролик не вернёт, посчитает модератор
      this.accounts.providerFor(url) !== null
    );
  }

  /** Просмотры и лайки по ссылкам; нет в карте — посчитать не удалось. */
  async fetchViews(videos: VideoRef[]): Promise<Map<string, VideoStats>> {
    const result = new Map<string, VideoStats>();
    const auto = videos.map((v) => v.url).filter((u) => this.isAutomatic(u));
    const youtube = byId(auto, (u) =>
      platformOf(u) === 'YOUTUBE' ? youtubeId(u) : null,
    );
    const x = byId(auto, xPostId);
    if (this.youtubeKey) await this.fetchYoutube(youtube, result);
    if (this.xToken) await this.fetchX(x, result);
    await this.fetchByCreator(videos, result);
    return result;
  }

  /** TikTok, VK и Instagram: ролики группируем по креатору и площадке — его аккаунты на ней спрашивает AccountsService. */
  private async fetchByCreator(
    videos: VideoRef[],
    result: Map<string, VideoStats>,
  ) {
    const groups = new Map<
      string,
      {
        creatorId: number;
        platform: SocialPlatform;
        urlsById: Map<string, string[]>;
      }
    >();
    for (const { url, creatorId } of videos) {
      const found = this.accounts.providerFor(url);
      if (!found) continue;
      const key = `${creatorId}:${found.provider.platform}`;
      const group = groups.get(key) ?? {
        creatorId,
        platform: found.provider.platform,
        urlsById: new Map<string, string[]>(),
      };
      group.urlsById.set(found.videoId, [
        ...(group.urlsById.get(found.videoId) ?? []),
        url,
      ]);
      groups.set(key, group);
    }
    for (const g of groups.values()) {
      const stats = await this.accounts.stats(g.creatorId, g.platform, [
        ...g.urlsById.keys(),
      ]);
      for (const [id, s] of stats) setAll(result, g.urlsById.get(id), s);
    }
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
        'YOUTUBE',
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
        'X',
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
    platform: string,
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
        recordExternalApi(platform, false);
        return null;
      }
      recordExternalApi(platform, true);
      return body;
    } catch (err) {
      this.logger.warn(`API просмотров недоступно: ${String(err)}`);
      recordExternalApi(platform, false);
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

function setAll(
  result: Map<string, VideoStats>,
  urls: string[] | undefined,
  stats: VideoStats,
) {
  for (const url of urls ?? []) result.set(url, stats);
}
