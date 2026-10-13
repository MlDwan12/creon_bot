import { randomBytes } from 'node:crypto';
import { TokenCrypto } from './token-crypto';

describe('TokenCrypto', () => {
  const key = randomBytes(32).toString('base64');

  it('шифрует и расшифровывает, каждый раз по-разному', () => {
    const c = new TokenCrypto(key);
    const a = c.encrypt('act.secret');
    expect(a).not.toContain('secret');
    expect(a).not.toBe(c.encrypt('act.secret'));
    expect(c.decrypt(a)).toBe('act.secret');
  });

  it('чужой ключ и подмена шифра — ошибка, а не мусор', () => {
    const stored = new TokenCrypto(key).encrypt('x');
    expect(() =>
      new TokenCrypto(randomBytes(32).toString('base64')).decrypt(stored),
    ).toThrow();
    const [v, iv, tag] = stored.split('.');
    expect(() =>
      new TokenCrypto(key).decrypt([v, iv, tag, 'AAAA'].join('.')),
    ).toThrow();
  });

  it('ключ не 32 байта — ошибка при старте', () => {
    expect(() => new TokenCrypto('c2hvcnQ=')).toThrow('32 байта');
  });
});
