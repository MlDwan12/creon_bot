import { type OrderFunnel, orderInsights } from './order-insights';

const now = new Date('2026-10-10T12:00:00Z').getTime();
const order = {
  id: 5,
  status: 'OPEN' as const,
  decidedAt: new Date(now - 3 * 24 * 3600_000),
  deadline: null,
};
const report = {
  summary: { budget: 1000, left: 800, videos: 1 },
  items: [] as { views: number; likes: number | null }[],
} as unknown as Parameters<typeof orderInsights>[1];
const funnel: OrderFunnel = {
  viewers: 0,
  taken: 0,
  expired: 0,
  onReview: 0,
  rejected: 0,
  approved: 0,
};
const codes = (...args: Parameters<typeof orderInsights>) =>
  orderInsights(...args).map((i) => i.code);

describe('orderInsights', () => {
  it('нормальный заказ — без советов', () => {
    expect(
      codes(order, report, { ...funnel, viewers: 40, taken: 5 }, now),
    ).toEqual([]);
  });

  it('смотрят, но не берут — только после 2 дней с публикации', () => {
    const f = { ...funnel, viewers: 40, taken: 1 };
    expect(codes(order, report, f, now)).toEqual(['NOT_TAKEN']);
    const fresh = { ...order, decidedAt: new Date(now - 3600_000) };
    expect(codes(fresh, report, f, now)).toEqual([]);
  });

  it('сгоревшие слоты и отклонённые ролики', () => {
    const f = { ...funnel, taken: 6, expired: 3, rejected: 3, approved: 3 };
    expect(codes(order, report, f, now)).toEqual(['SLOTS_BURN', 'REJECTED']);
  });

  it('вовлечённость — только по роликам с известными лайками', () => {
    const r = {
      ...report,
      items: [
        { views: 6000, likes: 60 },
        { views: 100_000, likes: null },
      ],
    } as typeof report;
    expect(codes(order, r, funnel, now)).toEqual(['LOW_ENGAGEMENT']);
  });

  it('бюджет кончается и срок с остатком — только у открытого заказа', () => {
    const r = {
      ...report,
      summary: { budget: 1000, left: 100, videos: 3 },
    } as typeof report;
    expect(codes(order, r, funnel, now)).toEqual(['BUDGET_ENDING']);
    const soon = { ...order, deadline: new Date(now + 3600_000) };
    expect(codes(soon, report, funnel, now)).toEqual(['DEADLINE_MONEY_LEFT']);
    expect(codes({ ...soon, status: 'CLOSED' }, report, funnel, now)).toEqual(
      [],
    );
  });
});
