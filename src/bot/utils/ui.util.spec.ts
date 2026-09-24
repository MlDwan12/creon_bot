import { navRow } from './ui.util';

describe('navRow', () => {
  const cb = (i: number) => `nav:${i}`;
  const data = (row: ReturnType<typeof navRow>) =>
    row.map((b) => [b.text, b.callback_data]);

  it('на первой позиции нет кнопки «назад»', () => {
    expect(data(navRow(0, 3, cb))).toEqual([
      [' ', 'noop'],
      ['1 / 3', 'noop'],
      ['▶️', 'nav:1'],
    ]);
  });

  it('в середине есть обе стрелки', () => {
    expect(data(navRow(1, 3, cb))).toEqual([
      ['◀️', 'nav:0'],
      ['2 / 3', 'noop'],
      ['▶️', 'nav:2'],
    ]);
  });

  it('на последней позиции нет кнопки «вперёд»', () => {
    expect(data(navRow(2, 3, cb))).toEqual([
      ['◀️', 'nav:1'],
      ['3 / 3', 'noop'],
      [' ', 'noop'],
    ]);
  });
});
