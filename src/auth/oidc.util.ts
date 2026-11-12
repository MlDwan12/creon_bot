import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey,
} from 'node:crypto';

/**
 * Вход на сайт через OpenID Connect Telegram (https://core.telegram.org/widgets/login):
 * редирект на oauth.telegram.org, возврат с code, обмен на id_token (Authorization Code + PKCE).
 * Client ID и Secret — BotFather → бот → Login Widget (OpenID Connect).
 */
const ISSUER = 'https://oauth.telegram.org';
const AUTH_URL = `${ISSUER}/auth`;
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

/** Cookie с state и code_verifier — между уходом на Telegram и возвратом. */
export const OIDC_COOKIE = 'fx_oidc';
/** Путь возврата — тот же адрес в BotFather (Redirect URIs), символ в символ. */
export const OIDC_CALLBACK_PATH = '/api/web/oidc/callback';

export type OidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Начало входа: адрес Telegram и значение cookie `<state>.<code_verifier>`. */
export function startOidc(config: OidcConfig): { url: string; cookie: string } {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), cookie: `${state}.${verifier}` };
}

/** state из адреса возврата совпал с cookie — code_verifier; иначе null (чужой или старый возврат). */
export function checkState(
  cookie: string | undefined,
  state: unknown,
): string | null {
  const m = /^([\w-]+)\.([\w-]+)$/.exec(cookie ?? '');
  if (!m || typeof state !== 'string' || state !== m[1]) return null;
  return m[2];
}

export type OidcUser = { id: number; username?: string; firstName?: string };

/** Обмен code на id_token и его проверка. null — Telegram отказал или токен не прошёл проверку. */
export async function finishOidc(
  config: OidcConfig,
  code: string,
  verifier: string,
): Promise<OidcUser | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const { id_token } = (await res.json()) as { id_token?: unknown };
  if (typeof id_token !== 'string') return null;
  let user = verifyIdToken(id_token, await jwks(), config.clientId);
  // ключ сменили — перечитываем набор ключей один раз
  if (user === 'unknown-key')
    user = verifyIdToken(id_token, await jwks(true), config.clientId);
  return typeof user === 'object' ? user : null;
}

let jwksCache: Promise<JsonWebKey[]> | undefined;

function jwks(refresh = false): Promise<JsonWebKey[]> {
  if (refresh || !jwksCache)
    jwksCache = fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`JWKS ${r.status}`);
        return r.json() as Promise<{ keys: JsonWebKey[] }>;
      })
      .then((j) => j.keys);
  // не удалось — следующий вход спросит снова
  jwksCache.catch(() => (jwksCache = undefined));
  return jwksCache;
}

/**
 * Проверка id_token: подпись RS256 ключом Telegram (JWKS), iss, aud = Client ID, срок.
 * ponytail: только RS256 (по умолчанию в BotFather); сменят алгоритм в Advanced — вход откажет, добавить ES256/EdDSA.
 */
export function verifyIdToken(
  token: string,
  keys: JsonWebKey[],
  clientId: string,
  nowMs = Date.now(),
): OidcUser | 'unknown-key' | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString(),
    ) as typeof header;
    claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString(),
    ) as typeof claims;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  const jwk = keys.find(
    (k) =>
      k.kty === 'RSA' && (header.kid === undefined || k.kid === header.kid),
  );
  if (!jwk) return 'unknown-key';
  const ok = verify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !ok ||
    claims.iss !== ISSUER ||
    !aud.map(String).includes(clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 < nowMs
  )
    return null;
  const id = Number(claims.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    id,
    username: str(claims.preferred_username),
    firstName: str(claims.given_name) ?? str(claims.name),
  };
}
