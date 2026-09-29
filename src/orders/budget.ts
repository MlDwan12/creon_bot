import { Currency, Prisma, SubmissionStatus } from '@prisma/client';

/** Порог просмотров для сдачи ролика, если рекламодатель не указал свой. */
export const DEFAULT_MIN_VIEWS = 250;

/** Сколько дней после одобрения добираются просмотры — потом модератор фиксирует итог. */
export const VIEWS_TOPUP_DAYS = 3;

/** Валюты заложены в базе, но пока принимаем только рубли — клиент валюту не показывает. */
export const ORDER_CURRENCY = Currency.RUB;

const DEFAULT_FEE_PERCENT = 20;

/** Комиссия площадки для новых заказов: env PLATFORM_FEE_PERCENT (проверяет env.validation), иначе 20%. */
export function platformFeePercent(): number {
  const raw = process.env.PLATFORM_FEE_PERCENT;
  return raw ? Number(raw) : DEFAULT_FEE_PERCENT;
}

/** Фонд выплат креаторам: бюджет без комиссии площадки. */
export function payoutPool(order: { budgetMinor: number; feePercent: number }) {
  return Math.floor((order.budgetMinor * (100 - order.feePercent)) / 100);
}

/**
 * Сколько бюджета рекламодателя ушло на выплаты креаторам вместе с комиссией площадки —
 * обратное к payoutPool. Вверх, чтобы в отчёте не занизить расход; не больше бюджета.
 */
export function budgetSpent(
  order: { budgetMinor: number; feePercent: number },
  payoutsMinor: number,
) {
  return Math.min(
    order.budgetMinor,
    Math.ceil((payoutsMinor * 100) / (100 - order.feePercent)),
  );
}

/** Выплата за просмотры по ставке за 1000. */
export function payoutFor(views: number, cpmMinor: number) {
  return Math.floor((views * cpmMinor) / 1000);
}

/** Отклики, за которыми закреплены деньги фонда: резерв на проверке и начисленное. */
export const HOLDS_MONEY: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.MODERATOR_APPROVED,
];

/** Сколько фонда уже занято по каждому заказу (резерв + начислено); нет в карте — 0. */
export async function spentByOrder(
  db: Prisma.TransactionClient,
  orderIds: number[],
) {
  const rows = await db.submission.groupBy({
    by: ['orderId'],
    where: { orderId: { in: orderIds }, status: { in: HOLDS_MONEY } },
    _sum: { payoutMinor: true },
  });
  return new Map(rows.map((r) => [r.orderId, r._sum.payoutMinor ?? 0]));
}

/**
 * Свободный остаток фонда и хватает ли его на ещё один ролик с порогом просмотров.
 * `cpmMinor` null — заказ ещё не одобрен: ставки нет, брать ролики нельзя.
 */
export function budgetState(
  order: {
    budgetMinor: number;
    feePercent: number;
    cpmMinor: number | null;
    minViews: number;
  },
  spent: number,
) {
  const free = Math.max(0, payoutPool(order) - spent);
  const minPayout =
    order.cpmMinor === null
      ? Infinity
      : payoutFor(order.minViews, order.cpmMinor);
  return { free, spent, exhausted: free < minPayout };
}
