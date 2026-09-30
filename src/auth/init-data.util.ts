import { createHmac, timingSafeEqual } from 'node:crypto';

export interface InitDataUser {
  id: number;
  username?: string;
  first_name?: string;
}

/**
 * Проверяет подпись `initData`, которую Telegram выдаёт Mini App, по алгоритму из
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * и возвращает пользователя. `null` — подпись не сошлась, данные устарели или битые.
 *
 * В подпись входят все поля, кроме `hash` (включая `signature`), отсортированные по ключу.
 */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSeconds: number,
  nowMs = Date.now(),
): InitDataUser | null {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const expected = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > maxAgeSeconds) {
    return null;
  }

  try {
    const user = JSON.parse(params.get('user') ?? '') as InitDataUser;
    return typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}
