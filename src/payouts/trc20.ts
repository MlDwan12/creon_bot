import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();

/**
 * Адрес TRON (TRC20): base58check — 21 байт (0x41 + 20 байт адреса) и 4 байта контрольной суммы.
 * Сумма ловит опечатку при ручном вводе, иначе выплата уйдёт в никуда.
 */
export function isTrc20Address(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(BASE58.indexOf(c));
  const hex = n.toString(16);
  if (hex.length > 50) return false;
  const bytes = Buffer.from(hex.padStart(50, '0'), 'hex');
  if (bytes[0] !== 0x41) return false;
  const checksum = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
  return checksum.equals(bytes.subarray(21));
}

/** Тело `PUT /api/profile/wallet`: пусто — убрать кошелёк. */
export function parseWallet(body: unknown): string | null {
  const raw = (body as { wallet?: unknown } | null)?.wallet;
  const wallet = typeof raw === 'string' ? raw.trim() : '';
  if (!wallet) return null;
  if (!isTrc20Address(wallet))
    throw new BadRequestException(
      'Это не адрес USDT в сети TRC20: он начинается с T и состоит из 34 символов. Скопируйте его из кошелька',
    );
  return wallet;
}
