import { freeForCreators } from './orders.controller';

describe('остаток фонда для креаторов', () => {
  it.each([
    [320_055, { free: 3200, freeUnder: null }], // 3 200,55 USDT → 3 200: точный остаток не видно
    [10_000, { free: 100, freeUnder: null }],
    [9_999, { free: 0, freeUnder: 100 }], // меньше 100 — «осталось меньше 100 USDT»
  ])('%i центов → %o', (minor, shown) => {
    expect(freeForCreators(minor)).toEqual(shown);
  });

  it('начисление другому креатору в пределах шага не видно', () => {
    expect(freeForCreators(329_900)).toEqual(freeForCreators(320_055)); // 3 299 и 3 200,55 USDT
  });
});
