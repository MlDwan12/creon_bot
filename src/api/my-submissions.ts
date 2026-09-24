import { type Order, type Submission, SubmissionStatus } from '@prisma/client';
import { kopecksToRubles } from '../common/money';

/**
 * «Мои отклики» для Mini App: каждый отклик (одно видео) — своя карточка; `attempt` — номер видео
 * по этому заказу, `latest` — самый новый отклик по заказу (отклонённый старый уже не требует внимания).
 * Поля перечислены явно: наружу не уходят модераторские данные и BigInt (не сериализуется в JSON).
 * `rows` — как отдаёт SubmissionsService.listByCreator: от новых к старым.
 */
export function toMySubmissions(rows: (Submission & { order: Order })[]) {
  const total = new Map<number, number>();
  for (const row of rows) {
    total.set(row.orderId, (total.get(row.orderId) ?? 0) + 1);
  }
  // Идём от новых к старым: номер видео по заказу убывает от total до 1.
  const next = new Map(total);
  return rows.map((row) => {
    const attempt = next.get(row.orderId)!;
    next.set(row.orderId, attempt - 1);
    return {
      id: row.id,
      status: row.status,
      attempt,
      latest: attempt === total.get(row.orderId),
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
        price: kopecksToRubles(row.order.priceKopecks),
        deadline: row.order.deadline,
        status: row.order.status,
      },
    };
  });
}
