import { requestLang, tr, trNum } from '../i18n/request-lang';
import { type Order, OrderStatus } from '@prisma/client';
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
      text: tr('insights.notTaken', {
        viewers: funnel.viewers,
        taken: funnel.taken,
      }),
    });

  if (funnel.expired >= 3 && funnel.expired / funnel.taken >= 0.4)
    result.push({
      code: 'SLOTS_BURN',
      text: tr('insights.slotsBurn', {
        expired: funnel.expired,
        taken: funnel.taken,
      }),
    });

  const judged = funnel.rejected + funnel.approved;
  if (funnel.rejected >= 3 && funnel.rejected / judged >= 0.3)
    result.push({
      code: 'REJECTED',
      text: tr('insights.rejected', { rejected: funnel.rejected, judged }),
    });

  // лайки известны не у всех роликов — считаем только по тем, где они есть
  const withLikes = report.items.filter((i) => i.likes !== null);
  const likedViews = withLikes.reduce((sum, i) => sum + i.views, 0);
  const likes = withLikes.reduce((sum, i) => sum + (i.likes ?? 0), 0);
  if (likedViews >= 5000 && likes / likedViews < 0.02)
    result.push({
      code: 'LOW_ENGAGEMENT',
      text: tr('insights.lowEngagement', {
        percent: ((likes / likedViews) * 100).toLocaleString(
          requestLang() === 'en' ? 'en-US' : 'ru-RU',
          { minimumFractionDigits: 1, maximumFractionDigits: 1 },
        ),
      }),
    });

  if (
    summary.clicks !== null &&
    summary.views >= 5000 &&
    summary.clicks / summary.views < 0.001
  )
    result.push({
      code: 'LOW_CLICKS',
      text: tr('insights.lowClicks', {
        views: trNum(summary.views),
        clicks: summary.clicks,
      }),
    });

  if (open && summary.videos >= 3 && summary.left / summary.budget < 0.2)
    result.push({
      code: 'BUDGET_ENDING',
      text: tr('insights.budgetEnding', {
        left: `${trNum(summary.left)} USDT`,
      }),
    });

  if (
    open &&
    order.deadline &&
    order.deadline.getTime() - now < SETTLE_MS &&
    summary.left / summary.budget > 0.5
  )
    result.push({
      code: 'DEADLINE_MONEY_LEFT',
      text: tr('insights.deadline'),
    });

  return result;
}
