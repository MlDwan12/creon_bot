import type { Order, Submission } from '@prisma/client';
import { toMySubmissions } from './my-submissions';

const order = (id: number): Order => ({
  id,
  advertiserId: 1,
  title: `Заказ ${id}`,
  description: 'd',
  currency: 'RUB',
  budgetMinor: 5_000_000,
  feePercent: 20,
  cpmMinor: 15_000,
  minViews: 250,
  minDurationSec: null,
  maxDurationSec: null,
  orientation: null,
  referenceUrl: null,
  targetUrl: null,
  category: 'OTHER',
  deadline: null,
  status: 'OPEN',
  moderatorId: 777n,
  moderatorComment: 'внутреннее',
  createdAt: new Date(0),
  moderationRequestedAt: new Date(0),
  decidedAt: null,
  closedAt: null,
  deadlineReminderSentAt: null,
  insightsSentAt: null,
});

const submission = (
  id: number,
  orderId: number,
  status: Submission['status'],
  extra: Partial<Submission> = {},
): Submission & { order: Order } => ({
  id,
  orderId,
  creatorId: 5,
  videoUrl: null,
  videoKey: null,
  trackCode: null,
  clicks: 0,
  status,
  moderatorId: 888n,
  moderatorComment: null,
  views: null,
  likes: null,
  payoutMinor: 0,
  finalizedAt: null,
  rating: null,
  review: null,
  portfolioAllowed: false,
  createdAt: new Date(id * 1000),
  submittedAt: null,
  decidedAt: null,
  slotReminderSentAt: null,
  order: order(orderId),
  ...extra,
});

describe('toMySubmissions', () => {
  it('срок сдачи — конец слота, но не позже срока заказа; у сданных его нет', () => {
    const created = new Date('2026-10-01T00:00:00Z');
    const early = new Date('2026-10-03T00:00:00Z');
    const [slot, deadline, sent] = toMySubmissions([
      submission(1, 1, 'IN_PROGRESS', { createdAt: created }),
      {
        ...submission(2, 2, 'IN_PROGRESS', { createdAt: created }),
        order: { ...order(2), deadline: early },
      },
      submission(3, 3, 'SUBMITTED', { createdAt: created }),
    ]);
    expect(slot.dueAt).toEqual(new Date('2026-10-08T00:00:00Z'));
    expect(deadline.dueAt).toEqual(early);
    expect(sent.dueAt).toBeNull();
  });

  // от новых к старым, как listByCreator
  const rows = [
    submission(3, 10, 'IN_PROGRESS'),
    submission(2, 20, 'MODERATOR_APPROVED', {
      views: 1200,
      payoutMinor: 18_000,
    }),
    submission(1, 10, 'MODERATOR_REJECTED', {
      moderatorComment: 'битая ссылка',
    }),
  ];
  const result = toMySubmissions(rows);

  it('каждое видео — своя карточка: номер по заказу и самое новое', () => {
    expect(result.map((r) => [r.id, r.order.id, r.attempt, r.latest])).toEqual([
      [3, 10, 2, true],
      [2, 20, 1, true],
      [1, 10, 1, false],
    ]);
  });

  it('комментарий — только у отклонённого', () => {
    expect(result[0].comment).toBeNull();
    expect(result[1].comment).toBeNull();
    expect(result[2].comment).toBe('битая ссылка');
  });

  it('деньги наружу — в USDT: ставка заказа и начисленное за ролик', () => {
    expect(result[0].order.cpm).toBe(150);
    expect(result[1].payout).toBe(180);
    expect(result[1].views).toBe(1200);
  });

  it('бюджет рекламодателя и комиссия наружу не уходят', () => {
    const json = JSON.stringify(result);
    expect(json).not.toContain('budget');
    expect(json).not.toContain('fee');
  });

  it('наружу не уходят модераторские поля и BigInt', () => {
    const json = JSON.stringify(result);
    expect(json).not.toContain('moderatorId');
    expect(json).not.toContain('внутреннее');
  });
});

describe('toMySubmissions — изменённый заказ на проверке', () => {
  it('новое название не показываем, пока его не проверил модератор', () => {
    const pending = {
      ...order(3),
      status: 'PENDING_MODERATION' as const,
      title: 'Пишите @adv',
    };
    const [row] = toMySubmissions([
      { ...submission(1, 3, 'IN_PROGRESS'), order: pending },
    ]);
    expect(row.order.title).toBe('Заказ #3 — на проверке у модератора');
  });
});
