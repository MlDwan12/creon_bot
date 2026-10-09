import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';

/*
 * Все смены статуса отклика — только здесь, условным `updateMany` по текущему статусу (см.
 * src/orders/order-status.ts). Деньги фонда, которые при этом освобождаются или начисляются,
 * считать под блокировкой заказа (lockBudget в SubmissionsService).
 */

type Db = Prisma.TransactionClient;

/** Переход, если отклик сейчас в одном из `from` (а его заказ — под `order`); 0 или 1. */
export async function tryTransitionSubmission(
  db: Db,
  submissionId: number,
  from: SubmissionStatus[],
  data: Prisma.SubmissionUpdateManyMutationInput,
  /** Условие на заказ — проверяется в том же запросе (срок мог истечь после проверки выше). */
  order?: Prisma.OrderWhereInput,
) {
  const { count } = await db.submission.updateMany({
    where: { id: submissionId, status: { in: from }, order },
    data,
  });
  return count;
}

/** То же, но конфликт — «уже обработан» (отклика нет — 404). */
export async function transitionSubmission(
  db: Db,
  submissionId: number,
  from: SubmissionStatus[],
  data: Prisma.SubmissionUpdateManyMutationInput,
  order?: Prisma.OrderWhereInput,
) {
  if (await tryTransitionSubmission(db, submissionId, from, data, order))
    return;
  if (!(await db.submission.findUnique({ where: { id: submissionId } })))
    throw new NotFoundException('Отклик не найден');
  throw new ForbiddenException('Этот отклик уже обработан');
}

/**
 * Ролики на проверке, которые больше не ждут модератора (заказ снят, автор заблокирован), —
 * отклонить с комментарием; резерв возвращается в фонд.
 */
export function rejectSubmitted(
  db: Db,
  where: { orderId?: { in: number[] }; creatorId?: number },
  comment: string,
) {
  return db.submission.updateMany({
    where: { ...where, status: SubmissionStatus.SUBMITTED },
    data: {
      status: SubmissionStatus.MODERATOR_REJECTED,
      moderatorComment: comment,
      payoutMinor: 0,
      decidedAt: new Date(),
    },
  });
}

/**
 * Заказ снят модератором или его автор заблокирован: отклики «в работе» сгорают, чтобы ролик по
 * такому заказу не сдали и не оплатили из его бюджета.
 */
export function expireSlots(db: Db, orderIds: number[]) {
  return db.submission.updateMany({
    where: { orderId: { in: orderIds }, status: SubmissionStatus.IN_PROGRESS },
    data: { status: SubmissionStatus.SLOT_EXPIRED, decidedAt: new Date() },
  });
}

/** Отклики креатора без видео — удалить (бан: работа не начата, истории нет). */
export function deleteInProgress(db: Db, creatorId: number) {
  return db.submission.deleteMany({
    where: { creatorId, status: SubmissionStatus.IN_PROGRESS },
  });
}
