import { createHash, createHmac } from 'node:crypto';
import {
  readCookie,
  signSession,
  SESSION_MAX_AGE_SECONDS,
  validateLoginWidget,
  verifySession,
} from './web-login.util';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60;

/** Подписывает поля так же, как Telegram Login Widget. */
function sign(fields: Record<string, string | number>, token = TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  const hash = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
  return { ...fields, hash };
}

const fields = {
  id: 42,
  first_name: 'Иван',
  username: 'ivan',
  photo_url: 'https://t.me/i/userpic/320/ivan.jpg',
  auth_date: NOW / 1000 - 60,
};

describe('validateLoginWidget', () => {
  it('принимает корректно подписанные данные', () => {
    expect(validateLoginWidget(sign(fields), TOKEN, DAY, NOW)).toEqual({
      user: { id: 42, first_name: 'Иван', username: 'ivan' },
      authDate: NOW / 1000 - 60,
    });
  });

  it('отклоняет подмену поля, чужой токен, устаревшие и битые данные', () => {
    expect(
      validateLoginWidget({ ...sign(fields), id: 1 }, TOKEN, DAY, NOW),
    ).toBeNull();
    expect(
      validateLoginWidget(sign(fields, '1:other'), TOKEN, DAY, NOW),
    ).toBeNull();
    expect(
      validateLoginWidget(
        sign({ ...fields, auth_date: NOW / 1000 - DAY - 1 }),
        TOKEN,
        DAY,
        NOW,
      ),
    ).toBeNull();
    // подпись мини-аппа (ключ от «WebAppData») сайту не годится
    expect(
      validateLoginWidget({ ...fields, hash: 'ab' }, TOKEN, DAY, NOW),
    ).toBeNull();
    expect(validateLoginWidget(null, TOKEN, DAY, NOW)).toBeNull();
    expect(
      validateLoginWidget({ ...sign(fields), x: { a: 1 } }, TOKEN, DAY, NOW),
    ).toBeNull();
  });
});

describe('сессия сайта', () => {
  const authDate = NOW / 1000 - 60;

  it('подписанная cookie читается обратно', () => {
    const raw = signSession(7, authDate, TOKEN);
    expect(verifySession(raw, TOKEN, NOW)).toEqual({ userId: 7, authDate });
  });

  it('отклоняет подмену пользователя, чужой токен и истёкший срок', () => {
    const raw = signSession(7, authDate, TOKEN);
    expect(verifySession(raw.replace(/^7\./, '8.'), TOKEN, NOW)).toBeNull();
    expect(verifySession(raw, '1:other', NOW)).toBeNull();
    expect(
      verifySession(
        raw,
        TOKEN,
        (authDate + SESSION_MAX_AGE_SECONDS + 1) * 1000,
      ),
    ).toBeNull();
    expect(verifySession(undefined, TOKEN, NOW)).toBeNull();
  });

  it('readCookie находит cookie среди других', () => {
    expect(readCookie('a=1; fx_session=7.1.x; b=2', 'fx_session')).toBe(
      '7.1.x',
    );
    expect(readCookie('xfx_session=1', 'fx_session')).toBeUndefined();
    expect(readCookie(undefined, 'fx_session')).toBeUndefined();
  });
});
