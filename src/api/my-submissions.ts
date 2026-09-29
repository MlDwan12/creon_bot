import {
  type Order,
  OrderStatus,
  type Submission,
  SubmissionStatus,
} from '@prisma/client';
import { kopecksToRubles } from '../common/money';
import { slotDueAt } from '../submissions/submissions.service';

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
          : null,
      views: row.views,
      // на проверке — резерв, после одобрения — начислено, отклонён — 0
      payout: kopecksToRubles(row.payoutMinor),
      finalized: row.finalizedAt !== null,
      createdAt: row.createdAt,
      // Сдать видео до конца слота, но не позже срока заказа.
      dueAt:
        row.status === SubmissionStatus.IN_PROGRESS
          ? earliest(slotDueAt(row.createdAt), row.order.deadline)
          : null,
      order: {
        id: row.order.id,
        // Изменённый заказ на проверке (или отклонённый после правки): новое название модератор ещё
        // не видел — в нём может быть контакт. Креатору — только номер.
        title:
          row.order.status === OrderStatus.PENDING_MODERATION ||
          row.order.status === OrderStatus.REJECTED
            ? `Заказ #${row.order.id} — на проверке у модератора`
            : row.order.title,
        cpm: kopecksToRubles(row.order.cpmMinor),
        minViews: row.order.minViews,
        deadline: row.order.deadline,
        status: row.order.status,
      },
    };
  });
}

function earliest(a: Date, b: Date | null) {
  return b && b < a ? b : a;
}
