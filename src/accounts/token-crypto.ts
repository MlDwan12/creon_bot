import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Токены площадок в базе — зашифрованы AES-256-GCM ключом SOCIAL_TOKENS_KEY (32 байта в base64):
 * утёкший дамп базы не даёт доступа к аккаунтам креаторов. Формат: v1.<iv>.<tag>.<шифр>, base64url.
 * ponytail: один ключ без ротации; понадобится сменить — новая версия формата рядом с v1.
 */
export class TokenCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32)
      throw new Error('SOCIAL_TOKENS_KEY — 32 байта в base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split('.');
    if (version !== 'v1' || !iv || !tag || !data)
      throw new Error('Неизвестный формат токена');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
