import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

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
  conflictMessage = 'Этот заказ уже обработан',
  also?: Prisma.OrderWhereInput,
) {
  if (await tryTransitionOrder(db, orderId, from, data, also)) return;
  if (!(await db.order.findUnique({ where: { id: orderId } })))
    throw new NotFoundException('Заказ не найден');
  throw new ForbiddenException(conflictMessage);
}

/** Закрыть открытые заказы из списка; уже не открытые не трогает. */
export async function closeOpenOrders(db: Db, orderIds: number[]) {
  const { count } = await db.order.updateMany({
    where: { id: { in: orderIds }, status: OrderStatus.OPEN },
    data: { status: OrderStatus.CLOSED, closedAt: new Date() },
  });
  return count;
}

/** Снять заказы, ждущие модератора, с комментарием — их увидит рекламодатель. */
export async function rejectPendingOrders(
  db: Db,
  orderIds: number[],
  comment: string,
) {
  const { count } = await db.order.updateMany({
    where: { id: { in: orderIds }, status: OrderStatus.PENDING_MODERATION },
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
