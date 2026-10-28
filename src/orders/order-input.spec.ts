import { BadRequestException } from '@nestjs/common';
import {
  parseBudgetConfirmed,
  parseCpm,
  parseOrderEdit,
  parseOrderInput,
  parseRejectComment,
} from './order-input';

const valid = {
  title: '  Распаковка наушников  ',
  description: 'Снять 30 секунд',
  referenceUrl: 'https://disk.yandex.ru/x',
  exampleUrls: [
    'https://www.tiktok.com/@anya/video/7412345678901234567',
    'https://www.instagram.com/reel/C9xAbCdEfGh/',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
  ],
  budget: 500,
  minViews: 250,
  minDurationSec: 15,
  maxDurationSec: 60,
  orientation: null,
  platforms: [],
  category: 'TECH',
  deadlineDays: 7,
};

describe('parseOrderInput', () => {
  it('невидимые символы форматирования вырезаются, склейка эмодзи — нет', () => {
    const r = parseOrderInput({
      ...valid,
      title: 'Обзор \u202eтовара\u200b',
      description: 'Семья 👨\u200d👩\u200d👧',
    });
    expect(r.title).toBe('Обзор товара');
    expect(r.description).toBe('Семья 👨\u200d👩\u200d👧');
  });

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

  it('требования к ролику: null и [] — любые, иначе ориентация и площадки (без повторов)', () => {
    expect(parseOrderInput(valid)).toMatchObject({
      minDurationSec: 15,
      maxDurationSec: 60,
      orientation: null,
      platforms: [],
    });
    expect(
      parseOrderInput({
        ...valid,
        minDurationSec: 15,
        maxDurationSec: 60,
        orientation: 'VERTICAL',
        platforms: ['TIKTOK', 'TIKTOK', 'INSTAGRAM'],
      }),
    ).toMatchObject({
      minDurationSec: 15,
      maxDurationSec: 60,
      orientation: 'VERTICAL',
      platforms: ['TIKTOK', 'INSTAGRAM'],
    });
  });

  it.each([
    ['минимум больше максимума', { minDurationSec: 60, maxDurationSec: 15 }],
    ['дробные секунды', { maxDurationSec: 1.5 }],
    ['больше 10 минут', { maxDurationSec: 601 }],
    ['неизвестная ориентация', { orientation: 'SQUARE' }],
    ['неизвестная площадка', { platforms: ['ONLYFANS'] }],
    ['площадки не списком', { platforms: 'TIKTOK' }],
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

  it.each([
    ['примеров роликов', { exampleUrls: undefined }],
    ['порога просмотров', { minViews: '' }],
    ['длительности от', { minDurationSec: '' }],
    ['длительности до', { maxDurationSec: undefined }],
    ['выбора ориентации', { orientation: undefined }],
    ['выбора площадок', { platforms: undefined }],
    ['категории', { category: undefined }],
    ['выбора срока', { deadlineDays: undefined }],
  ])(
    'всё, кроме брифа и ссылки на товар, обязательно — нет %s',
    (_name, patch) => {
      expect(() => parseOrderInput({ ...valid, ...patch })).toThrow(
        BadRequestException,
      );
    },
  );

  it('бриф — по желанию: пусто — undefined, в правке — null', () => {
    expect(
      parseOrderInput({ ...valid, referenceUrl: '' }).referenceUrl,
    ).toBeUndefined();
    expect(parseOrderEdit({ ...valid, referenceUrl: '' }).referenceUrl).toBe(
      null,
    );
  });

  it('примеры: от 3 до 10 ссылок на ролики, пустые строки и пробелы отбрасываются', () => {
    const r = parseOrderInput({
      ...valid,
      exampleUrls: ['  ', ...valid.exampleUrls.map((u) => ` ${u} `), ''],
    });
    expect(r.exampleUrls).toEqual(valid.exampleUrls);
    expect(parseOrderEdit(valid).exampleUrls).toEqual(valid.exampleUrls);
    // короткая ссылка TikTok из «Поделиться» — тоже ролик
    expect(
      parseOrderInput({
        ...valid,
        exampleUrls: [...valid.exampleUrls, 'https://vm.tiktok.com/ZMabc123/'],
      }).exampleUrls,
    ).toHaveLength(4);
  });

  it.each([
    ['два примера', { exampleUrls: valid.exampleUrls.slice(0, 2) }],
    [
      'одиннадцать примеров',
      {
        exampleUrls: Array.from(
          { length: 11 },
          (_, i) =>
            `https://www.tiktok.com/@a/video/74123456789012345${10 + i}`,
        ),
      },
    ],
    ['не список', { exampleUrls: valid.exampleUrls[0] }],
    [
      'не площадка',
      {
        exampleUrls: [
          ...valid.exampleUrls.slice(0, 2),
          'https://shop.example/v',
        ],
      },
    ],
    [
      'профиль, а не ролик',
      {
        exampleUrls: [
          ...valid.exampleUrls.slice(0, 2),
          'https://www.tiktok.com/@anya',
        ],
      },
    ],
    [
      'тот же ролик другой ссылкой',
      {
        exampleUrls: [...valid.exampleUrls, 'https://youtu.be/dQw4w9WgXcQ'],
      },
    ],
  ])('примеры — отклоняет: %s', (_name, patch) => {
    expect(() => parseOrderInput({ ...valid, ...patch })).toThrow(
      BadRequestException,
    );
  });

  it('ссылка в шапке — только со ссылкой на товар; не передана — нет', () => {
    expect(parseOrderInput(valid).linkInBio).toBe(false);
    expect(
      parseOrderInput({
        ...valid,
        targetUrl: 'https://shop.example/item',
        linkInBio: true,
      }).linkInBio,
    ).toBe(true);
    expect(() => parseOrderInput({ ...valid, linkInBio: true })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseOrderInput({
        ...valid,
        targetUrl: 'https://shop.example/item',
        linkInBio: 'да',
      }),
    ).toThrow(BadRequestException);
  });

  it('референс — без пробелов по краям', () => {
    expect(
      parseOrderInput({ ...valid, referenceUrl: ' https://disk.yandex.ru/x ' })
        .referenceUrl,
    ).toBe('https://disk.yandex.ru/x');
  });

  it('ссылка на товар — по тем же правилам, в правке пусто — null', () => {
    expect(
      parseOrderInput({ ...valid, targetUrl: 'https://shop.example/item' })
        .targetUrl,
    ).toBe('https://shop.example/item');
    expect(parseOrderEdit({ ...valid }).targetUrl).toBeNull();
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
    ['товар не ссылка', { targetUrl: 'наш сайт' }],
    ['товар — телеграм', { targetUrl: 'https://t.me/brand' }],
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
  const base = { ...valid, budget: 100, deadlineDays: undefined };

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

describe('parseBudgetConfirmed', () => {
  it('больше предела бюджета — 400, а не 500 от базы', () => {
    expect(() => parseBudgetConfirmed({ budgetConfirmed: 1e12 })).toThrow(
      BadRequestException,
    );
    expect(parseBudgetConfirmed({ budgetConfirmed: 100 })).toBe(10_000);
  });
});
