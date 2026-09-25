import { BadRequestException } from '@nestjs/common';
import {
  parseOrderEdit,
  parseOrderInput,
  parseRejectComment,
} from './order-input';

const valid = {
  title: '  Распаковка наушников  ',
  description: 'Снять 30 секунд',
  price: null,
  category: 'TECH',
  deadlineDays: 7,
};

describe('parseOrderInput', () => {
  it('чистит пробелы, без цены — «договорная», срок — в дату', () => {
    const before = Date.now();
    const r = parseOrderInput(valid);
    expect(r).toMatchObject({
      title: 'Распаковка наушников',
      description: 'Снять 30 секунд',
      priceKopecks: undefined,
      category: 'TECH',
    });
    const days = (r.deadline!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(7);
  });

  it('цена — целые рубли, в базу копейками; пустая строка — договорная', () => {
    expect(parseOrderInput({ ...valid, price: 3000 }).priceKopecks).toBe(
      300_000,
    );
    expect(
      parseOrderInput({ ...valid, price: '' }).priceKopecks,
    ).toBeUndefined();
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
    ['цена строкой', { price: '5000' }],
    ['дробная цена', { price: 99.5 }],
    ['нулевая цена', { price: 0 }],
    ['цена больше максимума', { price: 1_000_001 }],
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

describe('parseOrderEdit', () => {
  const base = { title: 'Название', description: 'Описание', category: 'FOOD' };

  it('срок: не передан — не менять, null — без срока, число — через N дней', () => {
    expect(parseOrderEdit(base).deadline).toBeUndefined();
    expect(parseOrderEdit({ ...base, deadlineDays: null }).deadline).toBeNull();
    expect(
      parseOrderEdit({ ...base, deadlineDays: 7 }).deadline,
    ).toBeInstanceOf(Date);
  });

  it('пустая цена — договорная (null, а не «не менять»)', () => {
    expect(parseOrderEdit({ ...base, price: null }).priceKopecks).toBeNull();
    expect(parseOrderEdit({ ...base, price: 500 }).priceKopecks).toBe(50_000);
  });
});
