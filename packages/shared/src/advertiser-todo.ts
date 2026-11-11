import type { MyOrder } from './api';

/** Что заказчику сделать по заказам — блок «Ждёт вас» в профиле. */
export type AdvertiserTodo = {
  kind: 'rate' | 'pending' | 'rejected' | 'fundBusy';
  orderId: number;
  title: string;
  /** Сколько роликов ждут оценки (для rate). */
  count: number;
};

/** Из списка заказов (GET /api/my-orders): сначала то, что ждёт действия заказчика, потом — модератора. */
export function advertiserTodo(orders: MyOrder[]): AdvertiserTodo[] {
  const todo = (kind: AdvertiserTodo['kind'], o: MyOrder, count = 0) => ({
    kind,
    orderId: o.id,
    title: o.title,
    count,
  });
  return [
    ...orders
      .filter((o) => o.status === 'REJECTED' || o.status === 'EDIT_REJECTED')
      .map((o) => todo('rejected', o)),
    ...orders.filter((o) => o.toRate > 0).map((o) => todo('rate', o, o.toRate)),
    ...orders.filter((o) => o.fundBusy).map((o) => todo('fundBusy', o)),
    ...orders
      .filter((o) => o.status === 'PENDING_MODERATION')
      .map((o) => todo('pending', o)),
  ];
}
