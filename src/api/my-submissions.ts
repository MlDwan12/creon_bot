import { type Order, type Submission, SubmissionStatus } from '@prisma/client';

/**
 * «Мои отклики» для Mini App: по одной карточке на заказ — последняя попытка и её номер.
 * Поля перечислены явно: наружу не уходят модераторские данные и BigInt (не сериализуется в JSON).
 * `rows` — как отдаёт SubmissionsService.listByCreator: от новых к старым.
 */
export function toMySubmissions(rows: (Submission & { order: Order })[]) {
  const attempts = new Map<number, number>();
  for (const row of rows) {
    attempts.set(row.orderId, (attempts.get(row.orderId) ?? 0) + 1);
  }
  const seen = new Set<number>();
  return rows
    .filter((row) => !seen.has(row.orderId) && seen.add(row.orderId))
    .map((row) => ({
      id: row.id,
      status: row.status,
      attempt: attempts.get(row.orderId)!,
      videoUrl: row.videoUrl,
      comment:
        row.status === SubmissionStatus.MODERATOR_REJECTED
          ? row.moderatorComment
          : row.status === SubmissionStatus.ADVERTISER_REJECTED
            ? row.advertiserComment
            : null,
      createdAt: row.createdAt,
      order: {
        id: row.order.id,
        title: row.order.title,
        price: row.order.price,
        deadline: row.order.deadline,
        status: row.order.status,
      },
    }));
}
