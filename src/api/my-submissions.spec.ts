import type { Order, Submission } from '@prisma/client';
import { toMySubmissions } from './my-submissions';

const order = (id: number): Order => ({
  id,
  advertiserId: 1,
  title: `Заказ ${id}`,
  description: 'd',
  priceKopecks: 150_000,
  category: 'OTHER',
  deadline: null,
  status: 'OPEN',
  moderatorId: 777n,
  moderatorComment: 'внутреннее',
  createdAt: new Date(0),
  decidedAt: null,
  closedAt: null,
  deadlineReminderSentAt: null,
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
  status,
  moderatorId: 888n,
  moderatorComment: null,
  advertiserComment: null,
  createdAt: new Date(id * 1000),
  submittedAt: null,
  decidedAt: null,
  order: order(orderId),
  ...extra,
});

describe('toMySubmissions', () => {
  // от новых к старым, как listByCreator
  const rows = [
    submission(3, 10, 'IN_PROGRESS'),
    submission(2, 20, 'ADVERTISER_REJECTED', { advertiserComment: 'не то' }),
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

  it('комментарий берётся от того, кто отклонил', () => {
    expect(result[0].comment).toBeNull();
    expect(result[1].comment).toBe('не то');
    expect(result[2].comment).toBe('битая ссылка');
  });

  it('цена наружу — в рублях', () => {
    expect(result[0].order.price).toBe(1500);
  });

  it('наружу не уходят модераторские поля и BigInt', () => {
    const json = JSON.stringify(result);
    expect(json).not.toContain('moderatorId');
    expect(json).not.toContain('внутреннее');
  });
});
