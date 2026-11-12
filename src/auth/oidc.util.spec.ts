import { generateKeyPairSync, sign } from 'node:crypto';
import { checkState, startOidc, verifyIdToken } from './oidc.util';

const NOW = 1_800_000_000_000;
const CLIENT = '8995614980';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KEYS = [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }];

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** id_token, подписанный как у Telegram (RS256). */
function token(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' },
  key = privateKey,
) {
  const data = `${b64(header)}.${b64(claims)}`;
  return `${data}.${sign('sha256', Buffer.from(data), key).toString('base64url')}`;
}

const claims = {
  iss: 'https://oauth.telegram.org',
  aud: CLIENT,
  sub: 'abc',
  exp: NOW / 1000 + 60,
  id: 42,
  given_name: 'Иван',
  name: 'Иван Петров',
  preferred_username: 'ivan',
};

describe('verifyIdToken', () => {
  it('принимает токен Telegram', () => {
    expect(verifyIdToken(token(claims), KEYS, CLIENT, NOW)).toEqual({
      id: 42,
      username: 'ivan',
      firstName: 'Иван',
    });
  });

  it('отклоняет чужую подпись, другой бот, чужой издатель, истёкший срок, alg none', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      verifyIdToken(
        token(claims, undefined, other.privateKey),
        KEYS,
        CLIENT,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyIdToken(token({ ...claims, aud: '1' }), KEYS, CLIENT, NOW),
    ).toBeNull();
    expect(
      verifyIdToken(token({ ...claims, iss: 'https://x' }), KEYS, CLIENT, NOW),
    ).toBeNull();
    expect(
      verifyIdToken(
        token({ ...claims, exp: NOW / 1000 - 1 }),
        KEYS,
        CLIENT,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyIdToken(token(claims, { alg: 'none' }), KEYS, CLIENT, NOW),
    ).toBeNull();
    expect(verifyIdToken('a.b', KEYS, CLIENT, NOW)).toBeNull();
  });

  it('незнакомый kid — перечитать ключи', () => {
    expect(
      verifyIdToken(
        token(claims, { alg: 'RS256', kid: 'k2' }),
        KEYS,
        CLIENT,
        NOW,
      ),
    ).toBe('unknown-key');
  });
});

describe('state входа', () => {
  it('state из адреса Telegram сверяется с cookie, чужой — нет', () => {
    const { url, cookie } = startOidc({
      clientId: CLIENT,
      clientSecret: 's',
      redirectUri: 'https://site/api/web/oidc/callback',
    });
    const state = new URL(url).searchParams.get('state');
    expect(checkState(cookie, state)).toBe(cookie.split('.')[1]);
    expect(checkState(cookie, 'other')).toBeNull();
    expect(checkState(undefined, state)).toBeNull();
  });
});
