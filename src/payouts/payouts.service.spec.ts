import { BadRequestException } from '@nestjs/common';
import { parsePayoutAmount } from './payouts.service';

describe('parsePayoutAmount', () => {
  it('целые USDT от минимума — в центы', () => {
    expect(parsePayoutAmount(10)).toBe(1_000);
    expect(parsePayoutAmount(250)).toBe(25_000);
  });

  it.each([[9], [10.5], ['50'], [null], [-10]])('отклоняет %p', (v) => {
    expect(() => parsePayoutAmount(v)).toThrow(BadRequestException);
  });
});
