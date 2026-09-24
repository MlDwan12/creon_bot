import { BadRequestException } from '@nestjs/common';
import { parseOrderInput, parseRejectComment } from './order-input';

const valid = {
  title: '  Распаковка наушников  ',
  description: 'Снять 30 секунд',
  price: '',
  category: 'TECH',
  deadlineDays: 7,
};

describe('parseOrderInput', () => {
  it('чистит пробелы, пустую цену превращает в «не указана», срок — в дату', () => {
    const before = Date.now();
    const r = parseOrderInput(valid);
    expect(r).toMatchObject({
      title: 'Распаковка наушников',
      description: 'Снять 30 секунд',
      price: undefined,
      category: 'TECH',
    });
    const days = (r.deadline!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(7);
  });

  it('без срока — deadline не задан', () => {
    expect(
      parseOrderInput({ ...valid, deadlineDays: null }).deadline,
    ).toBeUndefined();
  });

  it.each([
    ['пустое название', { title: '  ' }],
    ['название-заглушка', { title: '...' }],
    ['слишком длинное название', { title: 'x'.repeat(101) }],
    ['нет описания', { description: undefined }],
    ['чужая категория', { category: 'HACK' }],
    ['дробный срок', { deadlineDays: 2.5 }],
    ['срок строкой', { deadlineDays: '7' }],
    ['срок больше года', { deadlineDays: 366 }],
    ['слишком длинный бюджет', { price: 'x'.repeat(51) }],
  ])('отклоняет: %s', (_name, patch) => {
    expect(() => parseOrderInput({ ...valid, ...patch })).toThrow(
      BadRequestException,
    );
  });

  it('не падает на пустом теле', () => {
    expect(() => parseOrderInput(undefined)).toThrow(BadRequestException);
  });
});

describe('parseRejectComment', () => {
  it('возвращает причину без пробелов по краям', () => {
    expect(parseRejectComment({ comment: '  нет звука ' })).toBe('нет звука');
  });

  it('отклоняет пустую причину и заглушку', () => {
    expect(() => parseRejectComment({ comment: ' ' })).toThrow(
      BadRequestException,
    );
    expect(() => parseRejectComment({ comment: '-' })).toThrow(
      BadRequestException,
    );
    expect(() => parseRejectComment(null)).toThrow(BadRequestException);
  });
});
