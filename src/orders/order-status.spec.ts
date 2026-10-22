import type { Order } from '@prisma/client';
import { termsOf, videoTerms } from './order-status';

const order = (minViews: number, cpmMinor: number) =>
  ({ minViews, cpmMinor, editedAt: null, prevTerms: null }) as Order;

describe('условия ролика (videoTerms)', () => {
  const sent = new Date('2026-10-01');

  it('снимок при сдаче переживает две правки заказа', () => {
    // сдан при пороге 10 000; правка 1 подняла до 100 000, правка 2 — что угодно
    const atSubmit = termsOf(order(10_000, 500));
    const edited = {
      ...order(100_000, 900),
      editedAt: new Date('2026-10-05'),
      prevTerms: termsOf(order(100_000, 900)),
    };
    expect(videoTerms(edited, { submittedAt: sent, terms: atSubmit })).toEqual({
      minViews: 10_000,
      cpmMinor: 500,
    });
  });

  it('старый ролик без снимка: сдан до правки — по условиям до неё', () => {
    const edited = {
      ...order(100_000, 900),
      editedAt: new Date('2026-10-05'),
      prevTerms: { minViews: 10_000 },
    };
    expect(videoTerms(edited, { submittedAt: sent, terms: null })).toEqual({
      minViews: 10_000,
      cpmMinor: 900,
    });
    expect(
      videoTerms(edited, { submittedAt: new Date('2026-10-06'), terms: null }),
    ).toEqual({ minViews: 100_000, cpmMinor: 900 });
  });
});
