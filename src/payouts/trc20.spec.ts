import { BadRequestException } from '@nestjs/common';
import { isTrc20Address, parseWallet } from './trc20';

// адрес контракта USDT в TRON — заведомо существующий
const VALID = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('isTrc20Address', () => {
  it('принимает настоящий адрес', () => {
    expect(isTrc20Address(VALID)).toBe(true);
  });

  it.each([
    [
      'опечатка — не сходится контрольная сумма',
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u',
    ],
    ['короткий', VALID.slice(0, -1)],
    ['не с T', 'A' + VALID.slice(1)],
    ['символ не из base58', VALID.slice(0, -1) + '0'],
    ['адрес ERC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
  ])('отклоняет: %s', (_name, address) => {
    expect(isTrc20Address(address)).toBe(false);
  });
});

describe('parseWallet', () => {
  it('пусто — убрать кошелёк', () => {
    expect(parseWallet({ wallet: '  ' })).toBeNull();
    expect(parseWallet({})).toBeNull();
  });

  it('обрезает пробелы вокруг вставленного адреса', () => {
    expect(parseWallet({ wallet: ` ${VALID}\n` })).toBe(VALID);
  });

  it('неверный адрес — 400', () => {
    expect(() => parseWallet({ wallet: 'TR7NHqjeKQ' })).toThrow(
      BadRequestException,
    );
  });
});
