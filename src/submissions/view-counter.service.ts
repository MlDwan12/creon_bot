import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialPlatform } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { chunks, toStats, type VideoStats } from '../accounts/providers';
import {
  platformOf,
  type VideoAuthor,
  xPostId,
  youtubeId,
} from '../common/platforms';

export type { VideoStats } from '../accounts/providers';

const TIMEOUT_MS = 10_000;

/** Ролик и его автор: TikTok, VK и Instagram отдают просмотры только по токену самого креатора. */
export interface VideoRef {
  url: string;
  creatorId: number;
}

/**
 * Просмотры и, если просили, автор публикации. `ownAccount` — посчитано по токену аккаунта креатора:
 * площадка отдаёт только ролики владельца, значит ролик его.
 */
export type CountedVideo = VideoStats & {
  author?: VideoAuthor;
  ownAccount?: true;
};

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

  /**
   * Просмотры и лайки по ссылкам; нет в карте — посчитать не удалось. `withAuthor` — ещё и автор
   * (YouTube, X) для модератора: это лишний запрос к YouTube и чтение пользователей в X, поэтому
   * только по запросу, не в фоновых задачах.
   */
  async fetchViews(
    videos: VideoRef[],
    { withAuthor = false } = {},
  ): Promise<Map<string, CountedVideo>> {
    const result = new Map<string, CountedVideo>();
    const auto = videos.map((v) => v.url).filter((u) => this.isAutomatic(u));
    const youtube = byId(auto, (u) =>
      platformOf(u) === 'YOUTUBE' ? youtubeId(u) : null,
    );
    const x = byId(auto, xPostId);
    if (this.youtubeKey) await this.fetchYoutube(youtube, result, withAuthor);
    if (this.xToken) await this.fetchX(x, result, withAuthor);
    await this.fetchByCreator(videos, result);
    return result;
  }

  /** TikTok, VK и Instagram: ролики группируем по креатору и площадке — его аккаунты на ней спрашивает AccountsService. */
  private async fetchByCreator(
    videos: VideoRef[],
    result: Map<string, CountedVideo>,
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
      for (const [id, s] of stats)
        setAll(result, g.urlsById.get(id), { ...s, ownAccount: true });
    }
  }

  private async fetchYoutube(
    urlsById: Map<string, string[]>,
    result: Map<string, CountedVideo>,
    withAuthor: boolean,
  ) {
    const authors: VideoAuthor[] = [];
    // До 50 роликов за запрос — это 1 единица из суточной квоты 10 000 (snippet её не меняет).
    for (const batch of chunks([...urlsById.keys()], 50)) {
      const data = await this.get<{
        items?: {
          id: string;
          statistics?: { viewCount?: string; likeCount?: string };
          snippet?: { channelId?: string; channelTitle?: string };
        }[];
      }>(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics${withAuthor ? ',snippet' : ''}&id=${batch.join(',')}&key=${this.youtubeKey}`,
      );
      for (const item of data?.items ?? []) {
        const stats: CountedVideo | null = toStats(
          item.statistics?.viewCount,
          item.statistics?.likeCount,
        );
        if (!stats) continue;
        if (withAuthor && item.snippet?.channelId) {
          stats.author = {
            platform: 'YOUTUBE',
            id: item.snippet.channelId,
            handle: null,
            name: item.snippet.channelTitle ?? null,
          };
          authors.push(stats.author);
        }
        setAll(result, urlsById.get(item.id), stats);
      }
    }
    if (authors.length) await this.fillYoutubeHandles(authors);
  }

  /** @handle каналов (customUrl): по нему креатор обычно и даёт ссылку на канал в профиле. */
  private async fillYoutubeHandles(authors: VideoAuthor[]) {
    const ids = [...new Set(authors.map((a) => a.id))];
    for (const batch of chunks(ids, 50)) {
      const data = await this.get<{
        items?: { id: string; snippet?: { customUrl?: string } }[];
      }>(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${batch.join(',')}&key=${this.youtubeKey}`,
      );
      for (const item of data?.items ?? []) {
        const handle = item.snippet?.customUrl?.replace(/^@/, '') || null;
        for (const a of authors) if (a.id === item.id) a.handle = handle;
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
    result: Map<string, CountedVideo>,
    withAuthor: boolean,
  ) {
    // до 100 постов за запрос; платится каждый прочитанный пост
    for (const batch of chunks([...urlsById.keys()], 100)) {
      const data = await this.get<{
        data?: {
          id: string;
          author_id?: string;
          public_metrics?: { like_count?: number };
          attachments?: { media_keys?: string[] };
        }[];
        includes?: {
          media?: {
            media_key: string;
            type: string;
            public_metrics?: { view_count?: number };
          }[];
          users?: { id: string; username?: string; name?: string }[];
        };
      }>(
        withAuthor
          ? `https://api.x.com/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics,author_id&expansions=attachments.media_keys,author_id&media.fields=public_metrics,type&user.fields=username`
          : `https://api.x.com/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics&expansions=attachments.media_keys&media.fields=public_metrics,type`,
        { Authorization: `Bearer ${this.xToken}` },
      );
      const media = new Map(
        (data?.includes?.media ?? []).map((m) => [m.media_key, m]),
      );
      const users = new Map(
        (data?.includes?.users ?? []).map((u) => [u.id, u]),
      );
      for (const post of data?.data ?? []) {
        const video = (post.attachments?.media_keys ?? [])
          .map((k) => media.get(k))
          .find((m) => m?.type === 'video' || m?.type === 'animated_gif');
        const stats: CountedVideo | null = toStats(
          video?.public_metrics?.view_count,
          post.public_metrics?.like_count,
        );
        if (!stats) continue;
        if (withAuthor && post.author_id) {
          const u = users.get(post.author_id);
          stats.author = {
            platform: 'X',
            id: post.author_id,
            handle: u?.username ?? null,
            name: u?.name ?? null,
          };
        }
        setAll(result, urlsById.get(post.id), stats);
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

function setAll(
  result: Map<string, CountedVideo>,
  urls: string[] | undefined,
  stats: CountedVideo,
) {
  for (const url of urls ?? []) result.set(url, stats);
}
