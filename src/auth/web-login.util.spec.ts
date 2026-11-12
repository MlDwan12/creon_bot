import {
  readCookie,
  signSession,
  SESSION_MAX_AGE_SECONDS,
  verifySession,
} from './web-login.util';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000_000;

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
