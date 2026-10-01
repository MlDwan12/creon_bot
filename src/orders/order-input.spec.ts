import { BadRequestException } from '@nestjs/common';
import {
  parseCpm,
  parseOrderEdit,
  parseOrderInput,
  parseRejectComment,
} from './order-input';

const valid = {
  title: '  Распаковка наушников  ',
  description: 'Снять 30 секунд',
  budget: 500,
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
      budgetMinor: 50_000,
      minViews: 250,
      category: 'TECH',
    });
    const days = (r.deadline!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(7);
  });

  it('требования к ролику: пусто — любые, иначе секунды и ориентация', () => {
    expect(parseOrderInput(valid)).toMatchObject({
      minDurationSec: null,
      maxDurationSec: null,
      orientation: null,
    });
    expect(
      parseOrderInput({
        ...valid,
        minDurationSec: 15,
        maxDurationSec: 60,
        orientation: 'VERTICAL',
      }),
    ).toMatchObject({
      minDurationSec: 15,
      maxDurationSec: 60,
      orientation: 'VERTICAL',
    });
  });

  it.each([
    ['минимум больше максимума', { minDurationSec: 60, maxDurationSec: 15 }],
    ['дробные секунды', { maxDurationSec: 1.5 }],
    ['больше 10 минут', { maxDurationSec: 601 }],
    ['неизвестная ориентация', { orientation: 'SQUARE' }],
  ])('требования к ролику — отклоняет: %s', (_name, extra) => {
    expect(() => parseOrderInput({ ...valid, ...extra })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['без бюджета', { budget: undefined }],
    ['меньше минимума', { budget: 9 }],
    ['дробный', { budget: 100.5 }],
    ['строкой', { budget: '500' }],
    ['порог просмотров — ноль', { minViews: 0 }],
  ])('бюджет и порог — отклоняет: %s', (_name, extra) => {
    expect(() => parseOrderInput({ ...valid, ...extra })).toThrow(
      BadRequestException,
    );
  });

  it('порог просмотров: пусто — 250, иначе своё число', () => {
    expect(parseOrderInput({ ...valid, minViews: '' }).minViews).toBe(250);
    expect(parseOrderInput({ ...valid, minViews: 1000 }).minViews).toBe(1000);
  });

  it('референс: ссылка без пробелов по краям, пусто — без ссылки', () => {
    expect(
      parseOrderInput({ ...valid, referenceUrl: ' https://disk.yandex.ru/x ' })
        .referenceUrl,
    ).toBe('https://disk.yandex.ru/x');
    expect(
      parseOrderInput({ ...valid, referenceUrl: '' }).referenceUrl,
    ).toBeUndefined();
    expect(parseOrderEdit({ ...valid }).referenceUrl).toBeNull();
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
    ['бюджет больше максимума', { budget: 100_001 }],
    ['референс не ссылка', { referenceUrl: 'мой диск' }],
    ['референс — телеграм', { referenceUrl: 'https://t.me/brand' }],
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

describe('parseCpm', () => {
  it('USDT до центов — в центы', () => {
    expect(parseCpm({ cpm: 2 })).toBe(200);
    expect(parseCpm({ cpm: 1.25 })).toBe(125);
  });

  it.each([[0], [-5], ['1'], [null], [100.01]])('отклоняет %p', (cpm) => {
    expect(() => parseCpm({ cpm })).toThrow(BadRequestException);
  });
});

describe('parseOrderEdit', () => {
  const base = {
    title: 'Название',
    description: 'Описание',
    category: 'FOOD',
    budget: 100,
  };

  it('срок: не передан — не менять, null — без срока, число — через N дней', () => {
    expect(parseOrderEdit(base).deadline).toBeUndefined();
    expect(parseOrderEdit({ ...base, deadlineDays: null }).deadline).toBeNull();
    expect(
      parseOrderEdit({ ...base, deadlineDays: 7 }).deadline,
    ).toBeInstanceOf(Date);
  });

  it('бюджет — в центы', () => {
    expect(parseOrderEdit(base).budgetMinor).toBe(10_000);
  });
});
