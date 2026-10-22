import { toStats } from './providers';

describe('toStats', () => {
  it('просмотры и лайки из ответа площадки — целые от 0: дробное уронило бы запись в базу', () => {
    expect(toStats(1234.7, '9.5')).toEqual({ views: 1234, likes: 9 });
    expect(toStats(-5, -1)).toEqual({ views: 0, likes: 0 });
    expect(toStats(undefined, 3)).toBeNull();
    expect(toStats('100', undefined)).toEqual({ views: 100, likes: null });
  });
});
