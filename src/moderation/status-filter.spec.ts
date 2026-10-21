import { parseStatusFilter } from './status-filter';

describe('parseStatusFilter', () => {
  it('пусто — без фильтра, список через запятую — статусы', () => {
    expect(parseStatusFilter(undefined)).toEqual([]);
    expect(parseStatusFilter('')).toEqual([]);
    expect(parseStatusFilter('CLOSED, EXPIRED')).toEqual(['CLOSED', 'EXPIRED']);
  });

  it('неизвестный статус — 400', () => {
    expect(() => parseStatusFilter('OPEN,DELETED')).toThrow('status — из');
    expect(() => parseStatusFilter(['OPEN'])).toThrow('status — строка');
  });
});
