import { type Order, OrderStatus } from '@prisma/client';
import { formatMoney } from '../common/format';
import { DAY_MS } from './deadline';
import type { buildOrderReport } from './order-report';

/** Воронка заказа: открыли карточку → взяли → не успели / на проверке / отклонено / одобрено. */
export interface OrderFunnel {
  viewers: number;
  taken: number;
  expired: number;
  onReview: number;
  rejected: number;
  approved: number;
}

/** Совет рекламодателю: что поправить в заказе. */
export interface OrderInsight {
  code: string;
  text: string;
}

/** Раньше этого срока после публикации выводов о спросе не делаем — креаторы ещё не увидели заказ. */
const SETTLE_MS = 2 * DAY_MS;

/**
 * Выводы по заказу с советом, что поправить. Пороги — на глаз, пока не накопилась статистика.
 * ponytail: фиксированные пороги; когда заказов станет 30+, сравнивать с медианой по категории.
 */
export function orderInsights(
  order: Pick<Order, 'status' | 'decidedAt' | 'deadline'>,
  report: Pick<ReturnType<typeof buildOrderReport>, 'summary' | 'items'>,
  funnel: OrderFunnel,
  now = Date.now(),
): OrderInsight[] {
  const open = order.status === OrderStatus.OPEN;
  const settled =
    order.decidedAt !== null && now - order.decidedAt.getTime() >= SETTLE_MS;
  const { summary } = report;
  const result: OrderInsight[] = [];

  if (
    open &&
    settled &&
    funnel.viewers >= 20 &&
    funnel.taken / funnel.viewers < 0.05
  )
    result.push({
      code: 'NOT_TAKEN',
      text: `Заказ открыли ${funnel.viewers} креаторов, а взяли ${funnel.taken}. Условия не цепляют: снизьте порог просмотров, ослабьте требования к длительности и формату, приложите пример ролика.`,
    });

  if (funnel.expired >= 3 && funnel.expired / funnel.taken >= 0.4)
    result.push({
      code: 'SLOTS_BURN',
      text: `${funnel.expired} из ${funnel.taken} креаторов взяли заказ, но не прислали видео вовремя. Похоже, задача сложнее, чем кажется: упростите требования или опишите её подробнее.`,
    });

  const judged = funnel.rejected + funnel.approved;
  if (funnel.rejected >= 3 && funnel.rejected / judged >= 0.3)
    result.push({
      code: 'REJECTED',
      text: `Модератор отклонил ${funnel.rejected} из ${judged} роликов — креаторы понимают задачу не так. Уточните описание заказа.`,
    });

  // лайки известны не у всех роликов — считаем только по тем, где они есть
  const withLikes = report.items.filter((i) => i.likes !== null);
  const likedViews = withLikes.reduce((sum, i) => sum + i.views, 0);
  const likes = withLikes.reduce((sum, i) => sum + (i.likes ?? 0), 0);
  if (likedViews >= 5000 && likes / likedViews < 0.02)
    result.push({
      code: 'LOW_ENGAGEMENT',
      text: `Лайков — ${((likes / likedViews) * 100).toFixed(1)}% от просмотров: ролики смотрят, но не реагируют. Попробуйте другой посыл или формат.`,
    });

  if (
    summary.clicks !== null &&
    summary.views >= 5000 &&
    summary.clicks / summary.views < 0.001
  )
    result.push({
      code: 'LOW_CLICKS',
      text: `Ролики посмотрели ${summary.views.toLocaleString('ru-RU')} раз, а по ссылке на товар перешли ${summary.clicks}. Зрители не идут на сайт: попросите креаторов прямо звать по ссылке в описании и показать, что получит зритель.`,
    });

  if (open && summary.videos >= 3 && summary.left / summary.budget < 0.2)
    result.push({
      code: 'BUDGET_ENDING',
      text: `Ролики набирают просмотры, а бюджет почти закончился — осталось ${formatMoney(summary.left)}. Чтобы не останавливать поток роликов, увеличьте бюджет в заказе.`,
    });

  if (
    open &&
    order.deadline &&
    order.deadline.getTime() - now < SETTLE_MS &&
    summary.left / summary.budget > 0.5
  )
    result.push({
      code: 'DEADLINE_MONEY_LEFT',
      text: `До конца срока меньше 2 дней, а потрачено меньше половины бюджета. Продлите срок в «Мои заказы», чтобы собрать больше роликов.`,
    });

  return result;
}
