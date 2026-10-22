import { tr } from '../i18n/request-lang';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  type Order,
  OrderStatus,
  Prisma,
  type Submission,
} from '@prisma/client';

/*
 * Все смены статуса заказа — только здесь. Каждая — условный `updateMany` по текущему статусу:
 * из двух одновременных действий над одним заказом (двойной тап, два модератора) проходит одно,
 * второе видит `count === 0`. Функции принимают клиент транзакции — их зовут и другие модули
 * (бан, отклики), не создавая зависимостей между сервисами.
 */

type Db = Prisma.TransactionClient;

/** Переход, если заказ сейчас в одном из `from` (и подходит под `also`); число изменённых — 0 или 1. */
export async function tryTransitionOrder(
  db: Db,
  orderId: number,
  from: OrderStatus[],
  data: Prisma.OrderUpdateManyMutationInput,
  /** Доп. условие в том же запросе — например, версия, которую видел модератор. */
  also?: Prisma.OrderWhereInput,
) {
  const { count } = await db.order.updateMany({
    where: { ...also, id: orderId, status: { in: from } },
    data,
  });
  return count;
}

/** То же, но конфликт — ошибка с понятным текстом (заказа нет — 404). */
export async function transitionOrder(
  db: Db,
  orderId: number,
  from: OrderStatus[],
  data: Prisma.OrderUpdateManyMutationInput,
  conflictMessage?: string,
  also?: Prisma.OrderWhereInput,
) {
  if (await tryTransitionOrder(db, orderId, from, data, also)) return;
  if (!(await db.order.findUnique({ where: { id: orderId } })))
    throw new NotFoundException(tr('errors.orderNotFound'));
  throw new ForbiddenException(conflictMessage ?? tr('errors.orderProcessed'));
}

/** Статусы, в которых опубликованный заказ заморожен: правка на проверке или отклонена. */
export const FROZEN: OrderStatus[] = [
  OrderStatus.PENDING_MODERATION,
  OrderStatus.EDIT_REJECTED,
];

/**
 * Опубликованный заказ изменён и правку ещё не одобрили: новые ролики не сдают, слоты не сгорают,
 * рекламодатель может исправить правку или закрыть заказ. Ставка есть только у опубликованного.
 */
export function isFrozen(order: Pick<Order, 'status' | 'cpmMinor'>) {
  return order.cpmMinor !== null && FROZEN.includes(order.status);
}

/**
 * Фонд заказа для резерва и начислений: пока правка не одобрена — не больше одобренного бюджета.
 * Правка пишет новый бюджет в строку сразу, а доплату за повышение модератор подтверждает при
 * одобрении — иначе ролики на проверке оплатили бы из неоплаченного повышения.
 */
export function fundOf<
  T extends Pick<
    Order,
    'status' | 'cpmMinor' | 'budgetMinor' | 'approvedBudgetMinor'
  >,
>(order: T): T {
  if (!isFrozen(order) || order.approvedBudgetMinor === null) return order;
  return {
    ...order,
    budgetMinor: Math.min(order.budgetMinor, order.approvedBudgetMinor),
  };
}

/** Условия заказа, по которым проверяют ролики: снимок при сдаче (Submission.terms) и до правки (Order.prevTerms). */
export function termsOf(order: Order) {
  return {
    title: order.title,
    description: order.description,
    referenceUrl: order.referenceUrl,
    targetUrl: order.targetUrl,
    category: order.category,
    minViews: order.minViews,
    // ролик оплачивается по ставке, при которой его сдали (videoTerms)
    cpmMinor: order.cpmMinor,
    minDurationSec: order.minDurationSec,
    maxDurationSec: order.maxDurationSec,
    orientation: order.orientation,
    platforms: order.platforms,
  };
}

export type OrderTerms = ReturnType<typeof termsOf>;

/**
 * Условия, которые креатор видел при сдаче ролика, если они могли с тех пор измениться; null —
 * действуют текущие. Снимок при сдаче (Submission.terms) переживает любое число правок заказа;
 * у роликов, сданных до него, — снимок до правки (Order.prevTerms), если сдан раньше неё.
 */
export function submittedTerms(
  order: Pick<Order, 'editedAt' | 'prevTerms'>,
  submission: Pick<Submission, 'submittedAt' | 'terms'>,
): Partial<OrderTerms> | null {
  if (submission.terms) return submission.terms as Partial<OrderTerms>;
  const { submittedAt } = submission;
  return order.editedAt && submittedAt && submittedAt < order.editedAt
    ? (order.prevTerms as Partial<OrderTerms> | null)
    : null;
}

/**
 * Порог и ставка, по которым проверяют и оплачивают ролик — те, что были при сдаче (submittedTerms).
 * В старых снимках ставки нет — тогда текущая.
 */
export function videoTerms(
  order: Pick<Order, 'minViews' | 'cpmMinor' | 'editedAt' | 'prevTerms'>,
  submission: Pick<Submission, 'submittedAt' | 'terms'>,
) {
  const prev = submittedTerms(order, submission);
  return {
    minViews: prev?.minViews ?? order.minViews,
    cpmMinor: prev?.cpmMinor ?? order.cpmMinor,
  };
}

/** Закрыть открытые заказы из списка; уже не открытые не трогает. */
export async function closeOpenOrders(db: Db, orderIds: number[]) {
  const { count } = await db.order.updateMany({
    where: { id: { in: orderIds }, status: OrderStatus.OPEN },
    data: { status: OrderStatus.CLOSED, closedAt: new Date() },
  });
  return count;
}

/** Снять заказы, ждущие модератора или исправления правки, с комментарием — их увидит рекламодатель. */
export async function rejectPendingOrders(
  db: Db,
  orderIds: number[],
  comment: string,
) {
  const { count } = await db.order.updateMany({
    where: { id: { in: orderIds }, status: { in: FROZEN } },
    data: {
      status: OrderStatus.REJECTED,
      moderatorComment: comment,
      decidedAt: new Date(),
    },
  });
  return count;
}

/**
 * Блокировка строки заказа до конца транзакции: всё, что меняет занятый фонд заказа (резерв,
 * начисление, бюджет, публикация, снятие), идёт по очереди.
 */
export async function lockOrder(db: Db, orderId: number) {
  await db.$queryRaw`SELECT 1 FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
}
