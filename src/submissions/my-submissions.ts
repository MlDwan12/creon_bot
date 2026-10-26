import { tr } from '../i18n/request-lang';
import { type Order, type Submission, SubmissionStatus } from '@prisma/client';
import { fromMinor } from '../common/money';
import { titleVisibleToCreators } from '../common/format';
import { HOLD_DAYS } from '../orders/budget';
import { videoFormat } from '../orders/order-input';
import { slotDueAt } from './submissions.service';

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
      payout: fromMinor(row.payoutMinor),
      // согласился при сдаче на остаток фонда: просмотры сверх него не оплачиваются
      agreedPayout: fromMinor(row.agreedPayoutMinor),
      finalized: row.finalizedAt !== null,
      createdAt: row.createdAt,
      // Для шкалы статусов: сдан, проверен модератором и до когда холд (одобрен, итога ещё нет).
      submittedAt: row.submittedAt,
      decidedAt: row.decidedAt,
      holdEndsAt:
        row.status === SubmissionStatus.MODERATOR_APPROVED &&
        row.decidedAt &&
        !row.finalizedAt
          ? new Date(row.decidedAt.getTime() + HOLD_DAYS * 24 * 60 * 60 * 1000)
          : null,
      // Ссылка на товар для описания ролика; адрес сайта добавляет мини-апп. null — у заказа нет товара.
      trackPath:
        row.order.targetUrl && row.trackCode ? `/r/${row.trackCode}` : null,
      // Сдать видео до конца слота, но не позже срока заказа. Пока фонд «занят», слот на паузе
      // (fundPaused): срок сдвинется, когда место освободится.
      dueAt:
        row.status === SubmissionStatus.IN_PROGRESS && !row.order.fundBusyAt
          ? earliest(slotDueAt(row.createdAt), row.order.deadline)
          : null,
      fundPaused:
        row.status === SubmissionStatus.IN_PROGRESS &&
        row.order.fundBusyAt !== null,
      order: {
        id: row.order.id,
        title: titleVisibleToCreators(row.order)
          ? row.order.title
          : tr('errors.orderUnderReview', { id: row.order.id }),
        cpm: fromMinor(row.order.cpmMinor),
        minViews: row.order.minViews,
        deadline: row.order.deadline,
        status: row.order.status,
        // требования к ролику — для самопроверки перед сдачей
        ...videoFormat(row.order),
      },
    };
  });
}

function earliest(a: Date, b: Date | null) {
  return b && b < a ? b : a;
}
