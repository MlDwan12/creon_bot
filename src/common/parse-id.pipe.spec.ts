import { BadRequestException } from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';
import { isDbDate } from './validation';

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();

  it('пропускает id', () => {
    expect(pipe.transform('1')).toBe(1);
    expect(pipe.transform('2147483647')).toBe(2147483647);
  });

  it.each(['0', '-1', '1.5', 'abc', '', '2147483648', '99999999999999999999'])(
    'отклоняет %p',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});

describe('isDbDate', () => {
  it.each([
    ['2026-10-22T00:00:00Z', true],
    ['-010000-01-01T00:00:00Z', false], // JS принимает, Postgres — нет
    ['+275760-09-13T00:00:00Z', false],
    ['не дата', false],
  ])('%s → %s', (raw, ok) => {
    expect(isDbDate(new Date(raw))).toBe(ok);
  });
});
