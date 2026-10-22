import { ConfigService } from '@nestjs/config';
import { SocialPlatform } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  instagramShortcode,
  tiktokVideoId,
  vkVideoId,
} from '../common/platforms';
import { MAX_VIEWS } from '../common/validation';

const TIMEOUT_MS = 10_000;
/** VK ID не всегда отдаёт expires_in — тогда считаем, что access-токен живёт час. */
const DEFAULT_TTL_S = 3600;

export interface VideoStats {
  views: number;
  /** null — площадка лайки не отдала (автор скрыл). */
  likes: number | null;
}

export interface Tokens {
  externalId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  deviceId?: string;
}

/** Площадка отказала по существу (код протух, refresh отозван, не дали нужный доступ). */
export class ProviderRejected extends Error {}

/** Площадка недоступна: сеть, таймаут или 5xx. Только это — «API площадки сбоит» в метриках. */
export class PlatformUnavailable extends Error {}

/**
 * Площадка, где креатор подключает свой аккаунт через OAuth, и по его токену мы читаем просмотры
 * его роликов. Включается своими ключами в env — без них площадки нет, ролики считаются вручную.
 */
export interface Provider {
  platform: SocialPlatform;
  name: string;
  /** id ролика в формате API площадки; null — ссылку не разобрать. */
  videoId(url: string): string | null;
  authorizeUrl(p: {
    state: string;
    challenge: string;
    redirectUri: string;
  }): string;
  /** Обмен кода из callback на токены; `query` — параметры callback как пришли. */
  exchange(p: {
    query: Record<string, string>;
    verifier: string;
    redirectUri: string;
  }): Promise<Tokens>;
  refresh(p: {
    refreshToken: string;
    deviceId: string | null;
    externalId: string;
  }): Promise<Tokens>;
  /** Имя аккаунта — креатору, чтобы различать свои аккаунты; null — площадка не отдала. */
  label(accessToken: string): Promise<string | null>;
  /** Просмотры по id роликов; нет в карте — посчитать не удалось (не его ролик, удалён, сбой). */
  stats(accessToken: string, ids: string[]): Promise<Map<string, VideoStats>>;
  /**
   * Владелец ролика по id, если площадка отдаёт по токену и чужие публичные ролики (VK video.get):
   * ролик считается своим, только если владелец — сам подключённый аккаунт. Нет — площадка отдаёт
   * по токену только ролики владельца (TikTok, Instagram).
   */
  ownerOf?(videoId: string): string;
}

/** Ключи площадки заданы — она включена. */
export function enabledProviders(config: ConfigService): Provider[] {
  const get = (k: string) => config.get<string>(k) || undefined;
  const out: Provider[] = [];
  const tiktokKey = get('TIKTOK_CLIENT_KEY');
  const tiktokSecret = get('TIKTOK_CLIENT_SECRET');
  if (tiktokKey && tiktokSecret) out.push(tiktok(tiktokKey, tiktokSecret));
  const vkId = get('VK_CLIENT_ID');
  if (vkId) out.push(vk(vkId));
  const igId = get('INSTAGRAM_APP_ID');
  const igSecret = get('INSTAGRAM_APP_SECRET');
  if (igId && igSecret) out.push(instagram(igId, igSecret));
  return out;
}

/**
 * TikTok Login Kit (web) + Display API: scope video.list, /v2/video/query/ отдаёт только ролики
 * подключившего — заодно доказывает, что ролик его. Access-токен живёт сутки, refresh — год,
 * и refresh может смениться при обновлении.
 * https://developers.tiktok.com/doc/login-kit-web/ · /doc/oauth-user-access-token-management/ ·
 * /doc/tiktok-api-v2-video-query/
 */
function tiktok(clientKey: string, clientSecret: string): Provider {
  const SCOPE = 'user.info.basic,video.list';
  type TokenReply = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  const tokens = (r: TokenReply): Tokens => {
    if (!r.access_token || !r.refresh_token || !r.open_id)
      throw new ProviderRejected(
        r.error_description ?? r.error ?? 'нет токена',
      );
    if (r.scope && !r.scope.split(',').includes('video.list'))
      throw new ProviderRejected('не дан доступ к видео');
    return {
      externalId: r.open_id,
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      accessExpiresAt: expiresAt(r.expires_in),
    };
  };
  const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
  return {
    platform: SocialPlatform.TIKTOK,
    name: 'TikTok',
    videoId: tiktokVideoId,
    authorizeUrl: ({ state, redirectUri }) =>
      `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
        client_key: clientKey,
        response_type: 'code',
        scope: SCOPE,
        redirect_uri: redirectUri,
        state,
        // не входить молча в уже открытый аккаунт: креатор может добавлять второй
        disable_auto_auth: '1',
      }).toString()}`,
    async exchange({ query, redirectUri }) {
      if (query.error)
        throw new ProviderRejected(query.error_description ?? query.error);
      if (!query.code) throw new ProviderRejected('нет кода');
      return tokens(
        await postForm<TokenReply>(tokenUrl, {
          client_key: clientKey,
          client_secret: clientSecret,
          code: query.code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      );
    },
    async refresh({ refreshToken }) {
      return tokens(
        await postForm<TokenReply>(tokenUrl, {
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      );
    },
    async label(accessToken) {
      const r = await request<{
        data?: { user?: { display_name?: string } };
      }>('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return r.data?.user?.display_name || null;
    },
    async stats(accessToken, ids) {
      const out = new Map<string, VideoStats>();
      // до 20 роликов за запрос
      for (const batch of chunks(ids, 20)) {
        const r = await request<{
          data?: {
            videos?: { id: string; view_count?: number; like_count?: number }[];
          };
          error?: { code?: string; message?: string };
        }>(
          'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filters: { video_ids: batch } }),
          },
        );
        if (r.error?.code && r.error.code !== 'ok')
          throw new Error(`TikTok: ${r.error.code} ${r.error.message ?? ''}`);
        for (const v of r.data?.videos ?? []) {
          const stats = toStats(v.view_count, v.like_count);
          if (stats) out.set(v.id, stats);
        }
      }
      return out;
    },
  };
}

/**
 * VK ID (OAuth 2.1, PKCE обязателен) + API VK video.get. Право video выдаёт поддержка VK по заявке —
 * без него VK вернёт токен без scope video, и подключение откажет. В callback приходит device_id:
 * без него токен не обновить. https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/auth-without-sdk/auth-without-sdk-web
 */
function vk(clientId: string): Provider {
  const API_VERSION = '5.199';
  type TokenReply = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user_id?: number | string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  const tokens = (r: TokenReply, deviceId: string): Tokens => {
    if (!r.access_token || !r.refresh_token || !r.user_id)
      throw new ProviderRejected(
        r.error_description ?? r.error ?? 'нет токена',
      );
    if (r.scope && !r.scope.split(/[ ,]/).includes('video'))
      throw new ProviderRejected('не дан доступ к видео');
    return {
      externalId: String(r.user_id),
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      accessExpiresAt: expiresAt(r.expires_in),
      deviceId,
    };
  };
  const tokenUrl = 'https://id.vk.ru/oauth2/auth';
  return {
    platform: SocialPlatform.VK,
    name: 'VK',
    videoId: vkVideoId,
    // «-123_456» — ролик 456 владельца -123 (минус — сообщество: его ролики — не «свои», их проверяет модератор)
    ownerOf: (videoId) => videoId.split('_')[0],
    authorizeUrl: ({ state, challenge, redirectUri }) =>
      `https://id.vk.ru/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: 'video',
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()}`,
    async exchange({ query, verifier, redirectUri }) {
      if (query.error)
        throw new ProviderRejected(query.error_description ?? query.error);
      if (!query.code || !query.device_id)
        throw new ProviderRejected('нет кода');
      return tokens(
        await postForm<TokenReply>(tokenUrl, {
          grant_type: 'authorization_code',
          code: query.code,
          code_verifier: verifier,
          client_id: clientId,
          device_id: query.device_id,
          redirect_uri: redirectUri,
          state: query.state ?? randomState(),
        }),
        query.device_id,
      );
    },
    async refresh({ refreshToken, deviceId }) {
      if (!deviceId) throw new ProviderRejected('нет device_id');
      return tokens(
        await postForm<TokenReply>(tokenUrl, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          device_id: deviceId,
          state: randomState(),
        }),
        deviceId,
      );
    },
    async label(accessToken) {
      const r = await postForm<{
        user?: { first_name?: string; last_name?: string };
      }>('https://id.vk.ru/oauth2/user_info', {
        client_id: clientId,
        access_token: accessToken,
      });
      const name = [r.user?.first_name, r.user?.last_name]
        .filter(Boolean)
        .join(' ');
      return name || null;
    },
    async stats(accessToken, ids) {
      const out = new Map<string, VideoStats>();
      for (const batch of chunks(ids, 100)) {
        // токен — в теле, а не в адресе: адреса попадают в логи
        const r = await postForm<{
          response?: {
            items?: {
              owner_id: number;
              id: number;
              views?: number;
              likes?: { count?: number };
            }[];
          };
          error?: { error_code?: number; error_msg?: string };
        }>('https://api.vk.com/method/video.get', {
          videos: batch.join(','),
          access_token: accessToken,
          v: API_VERSION,
        });
        if (r.error)
          throw new Error(
            `VK: ${r.error.error_code} ${r.error.error_msg ?? ''}`,
          );
        for (const v of r.response?.items ?? []) {
          const stats = toStats(v.views, v.likes?.count);
          if (stats) out.set(`${v.owner_id}_${v.id}`, stats);
        }
      }
      return out;
    },
  };
}

/**
 * Instagram API with Instagram Login: только профессиональные аккаунты (Автор или Бизнес). Код →
 * короткий токен (час) → долгий (60 дней). Refresh-токена нет: долгий токен продлевается сам собой,
 * поэтому храним его и как refresh. Ролики ищем среди последних публикаций креатора по коду из
 * ссылки — это и доказывает, что ролик его; просмотры — insights `views`.
 * Для чужих аккаунтов (не тестировщиков приложения) нужна проверка приложения в Meta.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
 */
function instagram(appId: string, appSecret: string): Provider {
  const GRAPH = 'https://graph.instagram.com';
  const SCOPE = 'instagram_business_basic,instagram_business_manage_insights';
  /** ponytail: ищем среди 500 последних публикаций; ролик старше — посчитает модератор. */
  const MAX_PAGES = 5;
  type TokenReply = {
    access_token?: string;
    expires_in?: number;
    user_id?: number | string;
    permissions?: string | string[];
    error_message?: string;
    error?: { message?: string };
  };
  const longLived = (r: TokenReply, externalId: string): Tokens => {
    if (!r.access_token)
      throw new ProviderRejected(
        r.error?.message ?? r.error_message ?? 'нет токена',
      );
    return {
      externalId,
      accessToken: r.access_token,
      refreshToken: r.access_token,
      accessExpiresAt: expiresAt(r.expires_in),
    };
  };
  return {
    platform: SocialPlatform.INSTAGRAM,
    name: 'Instagram',
    videoId: instagramShortcode,
    authorizeUrl: ({ state, redirectUri }) =>
      `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        state,
        // спросить вход заново: креатор может добавлять второй аккаунт
        force_reauth: 'true',
      }).toString()}`,
    async exchange({ query, redirectUri }) {
      if (query.error)
        throw new ProviderRejected(
          query.error_description ?? query.error_reason ?? query.error,
        );
      // Instagram дописывает к коду «#_»
      const code = query.code?.replace(/#_$/, '');
      if (!code) throw new ProviderRejected('нет кода');
      const reply = await postForm<TokenReply & { data?: TokenReply[] }>(
        'https://api.instagram.com/oauth/access_token',
        {
          client_id: appId,
          client_secret: appSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        },
      );
      const short = reply.data?.[0] ?? reply;
      if (!short.access_token || !short.user_id)
        throw new ProviderRejected(
          short.error_message ?? short.error?.message ?? 'нет токена',
        );
      const permissions = Array.isArray(short.permissions)
        ? short.permissions
        : (short.permissions ?? '').split(',');
      if (
        short.permissions &&
        !permissions.includes('instagram_business_manage_insights')
      )
        throw new ProviderRejected('не дан доступ к статистике');
      return longLived(
        await request<TokenReply>(
          `${GRAPH}/access_token?${new URLSearchParams({
            grant_type: 'ig_exchange_token',
            client_secret: appSecret,
            access_token: short.access_token,
          }).toString()}`,
          {},
        ),
        String(short.user_id),
      );
    },
    async refresh({ refreshToken, externalId }) {
      return longLived(
        await request<TokenReply>(
          `${GRAPH}/refresh_access_token?${new URLSearchParams({
            grant_type: 'ig_refresh_token',
            access_token: refreshToken,
          }).toString()}`,
          {},
        ),
        externalId,
      );
    },
    async label(accessToken) {
      const r = await request<{ username?: string }>(
        `${GRAPH}/me?fields=username&access_token=${encodeURIComponent(accessToken)}`,
        {},
      );
      return r.username ? `@${r.username}` : null;
    },
    async stats(accessToken, ids) {
      const out = new Map<string, VideoStats>();
      const wanted = new Set(ids);
      const token = encodeURIComponent(accessToken);
      let next: string | undefined =
        `${GRAPH}/me/media?fields=id,shortcode,like_count&limit=100&access_token=${token}`;
      for (let page = 0; next && page < MAX_PAGES && wanted.size; page++) {
        const r: {
          data?: { id: string; shortcode?: string; like_count?: number }[];
          paging?: { next?: string };
          error?: { message?: string };
        } = await request(next, {});
        if (r.error) throw new Error(`Instagram: ${r.error.message ?? ''}`);
        for (const m of r.data ?? []) {
          if (!m.shortcode || !wanted.has(m.shortcode)) continue;
          wanted.delete(m.shortcode);
          const insights = await request<{
            data?: { name: string; values?: { value?: number }[] }[];
          }>(
            `${GRAPH}/${m.id}/insights?metric=views&access_token=${token}`,
            {},
          );
          const views = insights.data?.find((d) => d.name === 'views')
            ?.values?.[0]?.value;
          const stats = toStats(views, m.like_count);
          if (stats) out.set(m.shortcode, stats);
        }
        next = r.paging?.next;
      }
      return out;
    },
  };
}

/** state и PKCE: 32 случайных байта в base64url — 43 символа [A-Za-z0-9_-], как требует VK ID. */
export function randomState() {
  return randomBytes(32).toString('base64url');
}

function expiresAt(seconds: number | undefined) {
  const ttl = seconds && seconds > 0 ? seconds : DEFAULT_TTL_S;
  return new Date(Date.now() + ttl * 1000);
}

/**
 * Колонки просмотров — Int4: больше MAX_VIEWS не пишем (такой ролик — всё равно выше любого
 * бюджета). Лайков нет — null; просмотров нет — посчитать не удалось.
 */
export function toStats(
  views: string | number | undefined,
  likes: string | number | undefined,
): VideoStats | null {
  const v = Math.min(Number(views ?? NaN), MAX_VIEWS);
  if (!Number.isFinite(v)) return null;
  const l = Math.min(Number(likes ?? NaN), MAX_VIEWS);
  return { views: v, likes: Number.isFinite(l) ? l : null };
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function postForm<T>(url: string, params: Record<string, string>) {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

/**
 * JSON-ответ площадки. Ответ 4xx с телом — отдаём тело: в нём error/error_description, их
 * разбирает вызывающий. Сеть или 5xx — исключение (повторим в другой раз).
 */
async function request<T>(url: string, init: RequestInit): Promise<T> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlatformUnavailable(`${host}: ${String(err)}`);
  }
  if (res.status >= 500)
    throw new PlatformUnavailable(`${host}: ${res.status}`);
  return (await res.json()) as T;
}
