import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { InitDataUser } from './init-data.util';

/** Cookie сессии сайта: `<id пользователя>.<auth_date входа>.<подпись>`. */
export const SESSION_COOKIE = 'fx_session';
/** Сколько живёт вход на сайте: дальше — снова кнопка Telegram. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Проверяет данные Telegram Login Widget по алгоритму из
 * https://core.telegram.org/widgets/login#checking-authorization: ключ — SHA-256 токена бота,
 * в подпись входят все поля, кроме `hash`, отсортированные по ключу.
 * `null` — подпись не сошлась, данные устарели или битые.
 */
export function validateLoginWidget(
  data: unknown,
  botToken: string,
  maxAgeSeconds: number,
  nowMs = Date.now(),
): { user: InitDataUser; authDate: number } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    // виджет присылает id и auth_date числами, остальное — строками
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    fields[key] = String(value);
  }
  const { hash, ...rest } = fields;
  if (!hash) return null;

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;

  const authDate = Number(rest.auth_date);
  const id = Number(rest.id);
  if (
    !Number.isFinite(authDate) ||
    nowMs / 1000 - authDate > maxAgeSeconds ||
    !Number.isSafeInteger(id)
  )
    return null;
  return {
    user: { id, username: rest.username, first_name: rest.first_name },
    authDate,
  };
}

// ключ подписи сессий — из токена бота: сменили токен — все входы на сайте сброшены
function sessionMac(value: string, botToken: string): Buffer {
  const key = createHmac('sha256', 'WebSession').update(botToken).digest();
  return createHmac('sha256', key).update(value).digest();
}

/**
 * Сессия без таблицы — подписанная cookie. Выход стирает её в браузере; бан закрывает доступ сразу
 * (пользователь читается из базы на каждый запрос).
 * ponytail: украденную cookie до истечения срока не отозвать — понадобится «выйти везде»,
 * хранить в User время, раньше которого сессии недействительны.
 */
export function signSession(
  userId: number,
  authDate: number,
  botToken: string,
): string {
  const value = `${userId}.${authDate}`;
  return `${value}.${sessionMac(value, botToken).toString('base64url')}`;
}

export function verifySession(
  raw: string | undefined,
  botToken: string,
  nowMs = Date.now(),
): { userId: number; authDate: number } | null {
  const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(raw ?? '');
  if (!m) return null;
  const given = Buffer.from(m[3], 'base64url');
  const expected = sessionMac(`${m[1]}.${m[2]}`, botToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  const authDate = Number(m[2]);
  if (nowMs / 1000 - authDate > SESSION_MAX_AGE_SECONDS) return null;
  return { userId: Number(m[1]), authDate };
}

/** Значение cookie из заголовка `Cookie` (cookie-parser ради одной cookie не ставим). */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return part.slice(eq + 1).trim();
  }
  return undefined;
}
