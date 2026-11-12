import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cookie сессии сайта: `<id пользователя>.<auth_date входа>.<подпись>`. */
export const SESSION_COOKIE = 'fx_session';
/** Сколько живёт вход на сайте: дальше — снова кнопка Telegram. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

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
