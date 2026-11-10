import type { Order, Submission, User } from '@prisma/client';
import { tr } from '../i18n/request-lang';
import { publicName } from '../common/format';
import { fromMinor } from '../common/money';
import { type Platform, PLATFORMS, platformOf } from '../common/platforms';
import { budgetSpent } from './budget';
import { csvFile, videoLinkForAdvertiser } from './order-report';
import { DAY_MS } from './deadline';

/** Дней в графике «за всё время» — не больше. */
const MAX_DAYS = 365;

/** День по UTC: 2026-11-10. ponytail: UTC, а не часовой пояс заказчика — сдвиг до 3 ч у дневных столбиков. */
const dayKey = (at: Date) => at.toISOString().slice(0, 10);

/** Цена 1000 просмотров в USDT; просмотров нет — null. */
const cpm = (spentMinor: number, views: number) =>
  views ? fromMinor(Math.round((spentMinor * 1000) / views)) : null;

/**
 * Статистика заказчика по всем заказам: ролики, одобренные за период (`approved`, по `decidedAt`).
 * Деньги — как в отчёте заказа (src/orders/order-report.ts): выплаты креаторам с комиссией.
 * `snapshots` — замеры просмотров всех одобренных роликов заказчика за всё время: из них прирост по
 * дням (замеры идут при сдаче, одобрении и каждый день холда, после холда — нет).
 */
export function buildAdvertiserStats(
  orders: Order[],
  approved: (Submission & { creator: User })[],
  snapshots: { submissionId: number; views: number; at: Date }[],
  since: Date | undefined,
  now = new Date(),
) {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  // на ролик — без округления вверх, как у заказа целиком: иначе сумма по площадкам «уплывёт»
  const videoSpent = (s: Submission) =>
    (s.payoutMinor * 100) / (100 - orderById.get(s.orderId)!.feePercent);

  const byOrder = new Map<number, Submission[]>();
  for (const s of approved)
    byOrder.set(s.orderId, [...(byOrder.get(s.orderId) ?? []), s]);
  const orderRows = [...byOrder].map(([orderId, subs]) => {
    const order = orderById.get(orderId)!;
    const spent = budgetSpent(
      order,
      subs.reduce((sum, s) => sum + s.payoutMinor, 0),
    );
    const views = subs.reduce((sum, s) => sum + (s.views ?? 0), 0);
    return {
      id: order.id,
      title: order.title,
      status: order.status,
      spentMinor: spent,
      views,
      videos: subs.length,
      // без страницы товара переходов не бывает — null, а не 0
      clicks: order.targetUrl
        ? subs.reduce((sum, s) => sum + s.clicks, 0)
        : null,
    };
  });

  const byPlatform = new Map<
    Platform,
    { videos: number; views: number; spent: number }
  >();
  for (const s of approved) {
    const platform = platformOf(s.videoUrl);
    const stat = byPlatform.get(platform) ?? { videos: 0, views: 0, spent: 0 };
    byPlatform.set(platform, {
      videos: stat.videos + 1,
      views: stat.views + (s.views ?? 0),
      spent: stat.spent + videoSpent(s),
    });
  }

  const spentMinor = orderRows.reduce((sum, o) => sum + o.spentMinor, 0);
  const views = orderRows.reduce((sum, o) => sum + o.views, 0);
  // доля переходов — только по заказам со страницей товара: просмотры остальных её занизили бы
  const withLink = orderRows.filter((o) => o.clicks !== null);
  const clicks = withLink.length
    ? withLink.reduce((sum, o) => sum + o.clicks!, 0)
    : null;
  const linkViews = withLink.reduce((sum, o) => sum + o.views, 0);

  return {
    summary: {
      spent: fromMinor(spentMinor),
      views,
      likes: approved.reduce((sum, s) => sum + (s.likes ?? 0), 0),
      clicks,
      /** Переходы на 100 просмотров роликов со ссылкой на товар, %; null — не посчитать. */
      clickRate:
        clicks !== null && linkViews
          ? Math.round((clicks / linkViews) * 10000) / 100
          : null,
      videos: approved.length,
      creators: new Set(approved.map((s) => s.creatorId)).size,
      cpm: cpm(spentMinor, views),
    },
    daily: dailyGain(snapshots, since, now),
    orders: orderRows
      .sort((a, b) => b.views - a.views)
      .map(({ spentMinor: spent, ...o }) => ({
        ...o,
        spent: fromMinor(spent),
        cpm: cpm(spent, o.views),
      })),
    platforms: [...byPlatform]
      .map(([platform, p]) => ({
        platform,
        videos: p.videos,
        views: p.views,
        spent: fromMinor(Math.round(p.spent)),
        cpm: cpm(p.spent, p.views),
      }))
      .sort((a, b) => b.views - a.views),
    /** Все ролики периода, больше просмотров — выше: в ответе — первые 10, в CSV — все. */
    videos: [...approved]
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .map((s) => {
        const order = orderById.get(s.orderId)!;
        return {
          id: s.id,
          orderId: order.id,
          orderTitle: order.title,
          videoUrl: videoLinkForAdvertiser(s.trackCode),
          platform: platformOf(s.videoUrl),
          creator: publicName(s.creator),
          creatorId: s.creatorId,
          views: s.views ?? 0,
          likes: s.likes,
          clicks: order.targetUrl ? s.clicks : null,
          approvedAt: s.decidedAt,
        };
      }),
  };
}

/**
 * Прирост просмотров по дням периода: у ролика — рост над его прошлым максимумом (замер ниже
 * прошлого не вычитаем). Первый замер ролика целиком идёт в день сдачи.
 */
function dailyGain(
  snapshots: { submissionId: number; views: number; at: Date }[],
  since: Date | undefined,
  now: Date,
) {
  const sorted = [...snapshots].sort((a, b) => a.at.getTime() - b.at.getTime());
  const maxDays = since
    ? Math.ceil((now.getTime() - since.getTime()) / DAY_MS)
    : MAX_DAYS;
  const firstAt = since ?? sorted[0]?.at;
  if (!firstAt) return [];
  const start = Math.max(firstAt.getTime(), now.getTime() - maxDays * DAY_MS);
  const days = new Map<string, number>();
  for (let t = start; dayKey(new Date(t)) <= dayKey(now); t += DAY_MS)
    days.set(dayKey(new Date(t)), 0);

  const best = new Map<number, number>();
  for (const snap of sorted) {
    const prev = best.get(snap.submissionId) ?? 0;
    if (snap.views <= prev) continue;
    best.set(snap.submissionId, snap.views);
    const day = dayKey(snap.at);
    if (days.has(day)) days.set(day, days.get(day)! + snap.views - prev);
  }
  return [...days].map(([date, views]) => ({ date, views }));
}

type Stats = ReturnType<typeof buildAdvertiserStats>;

/** Все ролики периода файлом CSV — как отчёт заказа, с колонкой заказа. */
export function statsCsv(stats: Stats): string {
  return csvFile([
    [
      tr('errors.csvOrder'),
      tr('errors.csvCreator'),
      tr('errors.csvPlatform'),
      tr('errors.csvLink'),
      tr('errors.csvViews'),
      tr('errors.csvLikes'),
      tr('errors.csvClicks'),
      tr('errors.csvApproved'),
    ],
    ...stats.videos.map((v) => [
      v.orderTitle,
      v.creator,
      v.platform === 'OTHER'
        ? tr('errors.csvOther')
        : PLATFORMS[v.platform].name,
      v.videoUrl ?? '',
      v.views,
      v.likes ?? '',
      v.clicks ?? '',
      v.approvedAt ? v.approvedAt.toISOString().slice(0, 10) : '',
    ]),
  ]);
}
