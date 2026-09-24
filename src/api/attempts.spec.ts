import { attemptNumbers } from './attempts';

describe('attemptNumbers', () => {
  it('нумерует попытки каждого креатора отдельно, со старых', () => {
    const at = (min: number) => new Date(min * 60_000);
    const result = attemptNumbers([
      { id: 30, creatorId: 1, createdAt: at(30) },
      { id: 10, creatorId: 1, createdAt: at(10) },
      { id: 20, creatorId: 2, createdAt: at(20) },
      { id: 25, creatorId: 1, createdAt: at(25) },
    ]);
    expect(Object.fromEntries(result)).toEqual({ 10: 1, 25: 2, 30: 3, 20: 1 });
  });
});
