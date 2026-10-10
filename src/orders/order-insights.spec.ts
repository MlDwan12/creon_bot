import { type OrderFunnel, orderInsights } from './order-insights';

const now = new Date('2026-10-10T12:00:00Z').getTime();
const order = {
  id: 5,
  status: 'OPEN' as const,
  decidedAt: new Date(now - 3 * 24 * 3600_000),
  deadline: null,
};
const report = {
  summary: {
    budget: 1000,
    left: 800,
    videos: 1,
    views: 0,
    clicks: null,
    sales: null,
  },
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

  it('смотрят, но не переходят — только если у заказа есть страница товара', () => {
    const summary = { ...report.summary, views: 20_000, clicks: 5 };
    expect(codes(order, { ...report, summary }, funnel, now)).toEqual([
      'LOW_CLICKS',
    ]);
    const noTarget = { ...summary, clicks: null };
    expect(codes(order, { ...report, summary: noTarget }, funnel, now)).toEqual(
      [],
    );
  });

  it('много переходов, мало продаж — разный текст, когда продаж нет совсем', () => {
    const summary = { ...report.summary, clicks: 200, sales: 0 };
    const [none] = orderInsights(order, { ...report, summary }, funnel, now);
    expect(none.code).toBe('LOW_SALES');
    expect(none.text).toContain('подключите');
    const [few] = orderInsights(
      order,
      { ...report, summary: { ...summary, sales: 1 } },
      funnel,
      now,
    );
    expect(few.text).toContain('купили 1');
    expect(
      codes(
        order,
        { ...report, summary: { ...summary, sales: 5 } },
        funnel,
        now,
      ),
    ).toEqual([]);
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
