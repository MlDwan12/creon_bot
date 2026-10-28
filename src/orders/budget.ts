import { Currency, Prisma, SubmissionStatus } from '@prisma/client';

/**
 * Холд: начисленное по ролику можно вывести только через столько дней после одобрения, когда
 * модератор (или API площадки) проверит, что публикация на месте (PayoutsService.balance), — чтобы
 * ролик не удаляли сразу после оплаты. Платим только за просмотры при одобрении, доплат нет.
 */
export const HOLD_DAYS = 5;

/** Все деньги площадки — в USDT; другие валюты в enum остались от старых заказов. */
export const ORDER_CURRENCY = Currency.USDT;

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

/**
 * Рекламодатель поднял бюджет после последнего одобрения — модератор подтверждает, что доплата
 * получена (оплата вне бота). Первую модерацию и понижение не трогает.
 */
export function budgetRaised(order: {
  budgetMinor: number;
  approvedBudgetMinor: number | null;
}) {
  return (
    order.approvedBudgetMinor !== null &&
    order.budgetMinor > order.approvedBudgetMinor
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

/** Отклики без сданного видео: такие не мешают удалить заказ. */
export const NO_VIDEO: SubmissionStatus[] = [
  SubmissionStatus.IN_PROGRESS,
  SubmissionStatus.SLOT_EXPIRED,
];

/** Начисленное окончательно — по нему заказ закрывается: резерв ещё может вернуться в фонд. */
export const ACCRUED: SubmissionStatus[] = [
  SubmissionStatus.MODERATOR_APPROVED,
];

/**
 * Сколько фонда уже занято по каждому заказу (по умолчанию резерв + начислено); нет в карте — 0.
 */
export async function spentByOrder(
  db: Prisma.TransactionClient,
  orderIds: number[],
  statuses: SubmissionStatus[] = HOLDS_MONEY,
) {
  const rows = await db.submission.groupBy({
    by: ['orderId'],
    where: { orderId: { in: orderIds }, status: { in: statuses } },
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

/** Меньше заказов со ставкой в категории — подсказку цены не показываем: выйдет случайное число. */
export const PRICE_HINT_MIN_ORDERS = 3;

/**
 * Сколько обычно стоят рекламодателю 1000 просмотров: медиана по заказам со ставкой, с комиссией —
 * как «цена 1000 просмотров» в отчёте (budgetSpent). Центы; null — заказов меньше PRICE_HINT_MIN_ORDERS.
 */
export function typicalPriceMinor(
  orders: { cpmMinor: number | null; feePercent: number }[],
): number | null {
  const prices = orders
    .filter((o) => o.cpmMinor !== null)
    // без потолка бюджета: тут не расход заказа, а цена за 1000 просмотров
    .map((o) => budgetSpent({ ...o, budgetMinor: Infinity }, o.cpmMinor!))
    .sort((a, b) => a - b);
  if (prices.length < PRICE_HINT_MIN_ORDERS) return null;
  const mid = prices.length >> 1;
  return prices.length % 2
    ? prices[mid]
    : Math.round((prices[mid - 1] + prices[mid]) / 2);
}
