import { budgetSpent, budgetState, payoutFor, payoutPool } from './budget';

describe('бюджет заказа', () => {
  const order = {
    budgetMinor: 5_000_000,
    feePercent: 20,
    cpmMinor: 10_000,
    minViews: 250,
  };

  it('фонд выплат — бюджет без комиссии', () => {
    expect(payoutPool(order)).toBe(4_000_000);
  });

  it('выплата — по ставке за 1000 просмотров, центы вниз', () => {
    expect(payoutFor(1000, 10_000)).toBe(10_000);
    expect(payoutFor(1, 333)).toBe(0);
    expect(payoutFor(1500, 333)).toBe(499);
  });

  it('остаток исчерпан, когда его не хватает на ролик с порогом', () => {
    // порог 250 просмотров × 100 USDT за 1000 = 25 USDT
    expect(budgetState(order, 4_000_000 - 2_500).exhausted).toBe(false);
    expect(budgetState(order, 4_000_000 - 2_499).exhausted).toBe(true);
    expect(budgetState(order, 5_000_000).free).toBe(0);
  });

  it('расход бюджета — выплаты вместе с комиссией, обратно к фонду', () => {
    expect(budgetSpent(order, 4_000_000)).toBe(5_000_000);
    expect(budgetSpent(order, 8_000)).toBe(10_000);
    expect(budgetSpent(order, 1)).toBe(2); // вверх
    expect(budgetSpent({ ...order, feePercent: 0 }, 700)).toBe(700);
  });

  it('без ставки (не одобрен) — брать ролики нельзя', () => {
    expect(budgetState({ ...order, cpmMinor: null }, 0).exhausted).toBe(true);
  });
});
