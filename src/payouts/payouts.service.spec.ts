import { BadRequestException } from '@nestjs/common';
import { parsePayoutAmount } from './payouts.service';

describe('parsePayoutAmount', () => {
  it('целые рубли от минимума — в копейки', () => {
    expect(parsePayoutAmount(100)).toBe(10_000);
    expect(parsePayoutAmount(2500)).toBe(250_000);
  });

  it.each([[99], [100.5], ['500'], [null], [-100]])('отклоняет %p', (v) => {
    expect(() => parsePayoutAmount(v)).toThrow(BadRequestException);
  });
});
