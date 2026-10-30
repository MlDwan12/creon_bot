import { tr } from '../i18n/request-lang';
import {
  type Order,
  type Submission,
  SubmissionStatus,
  type User,
} from '@prisma/client';
import { publicName } from '../common/format';
import { fromMinor } from '../common/money';
import { type Platform, PLATFORMS, platformOf } from '../common/platforms';
import { budgetSpent } from './budget';

/**
 * Ссылка на ролик для рекламодателя — через свой редирект /v/<код> (VideoLinkController): в самой
 * ссылке площадки ник креатора (tiktok.com/@anya/…), а стороны не видят контактов друг друга.
 * На странице ролика ник всё равно есть — защита частичная, зато не в отчёте и CSV.
 * null — у старого отклика нет кода.
 */
export function videoLinkForAdvertiser(trackCode: string | null) {
  return trackCode ? `${appBase()}/v/${trackCode}` : null;
}

/**
 * Пример ролика из заказа для креатора — тоже через редирект: /v/e/<заказ>/<номер с 1>
 * (VideoLinkController). В ссылке площадки ник автора, а им может оказаться сам рекламодатель.
 */
export function exampleLink(orderId: number, index: number) {
  return `${appBase()}/v/e/${orderId}/${index + 1}`;
}

/** Ссылка креатора на товар /r/<код> целиком — модератору проверить её в шапке профиля. */
export function trackLink(trackCode: string | null) {
  return trackCode ? `${appBase()}/r/${trackCode}` : null;
}

function appBase() {
  return (process.env.WEBAPP_URL ?? '').replace(/\/$/, '');
}

/**
 * Отчёт рекламодателю по заказу: сводка, площадки и одобренные ролики (больше просмотров — выше).
 * Деньги — со стороны рекламодателя: выплаты креаторам вместе с комиссией, в USDT. Сколько
 * получил конкретный креатор, рекламодатель не видит.
 */
export function buildOrderReport(
  order: Order,
  rows: (Submission & { creator: User })[],
) {
  const approved = rows
    .filter((s) => s.status === SubmissionStatus.MODERATOR_APPROVED)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const sum = (list: Submission[]) =>
    list.reduce((total, s) => total + s.payoutMinor, 0);
  const paid = sum(approved);
  const onReview = sum(
    rows.filter((s) => s.status === SubmissionStatus.SUBMITTED),
  );
  const spent = budgetSpent(order, paid);
  const reserved = budgetSpent(order, paid + onReview) - spent;
  const views = approved.reduce((total, s) => total + (s.views ?? 0), 0);
  // лайки известны не по всем роликам (вне YouTube их вводит модератор по желанию)
  const likes = approved.reduce((total, s) => total + (s.likes ?? 0), 0);
  // без страницы товара переходов не бывает — «0» вводил бы в заблуждение
  const clicks = order.targetUrl
    ? approved.reduce((total, s) => total + s.clicks, 0)
    : null;

  const byPlatform = new Map<Platform, { videos: number; views: number }>();
  const items = approved.map((s) => {
    const platform = platformOf(s.videoUrl);
    const stat = byPlatform.get(platform) ?? { videos: 0, views: 0 };
    byPlatform.set(platform, {
      videos: stat.videos + 1,
      views: stat.views + (s.views ?? 0),
    });
    return {
      id: s.id,
      videoUrl: videoLinkForAdvertiser(s.trackCode),
      platform,
      creator: publicName(s.creator),
      creatorId: s.creatorId,
      views: s.views ?? 0,
      likes: s.likes,
      clicks: order.targetUrl ? s.clicks : null,
      rating: s.rating,
      // оценку ставят один раз; снятую модератором — не ставят заново
      rateable: s.rating === null && !s.reviewRemovedAt,
      approvedAt: s.decidedAt,
    };
  });

  return {
    order: { id: order.id, title: order.title, status: order.status },
    summary: {
      budget: fromMinor(order.budgetMinor),
      spent: fromMinor(spent),
      /** Зарезервировано под ролики на проверке. */
      reserved: fromMinor(reserved),
      left: fromMinor(Math.max(0, order.budgetMinor - spent - reserved)),
      views,
      likes,
      /** Переходы по ссылкам на товар из одобренных роликов; null — у заказа нет страницы товара. */
      clicks,
      videos: approved.length,
      creators: new Set(approved.map((s) => s.creatorId)).size,
      /** Фактическая цена 1000 просмотров для рекламодателя; нет просмотров — null. */
      cpm: views ? fromMinor(Math.round((spent * 1000) / views)) : null,
    },
    platforms: [...byPlatform]
      .map(([platform, stat]) => ({ platform, ...stat }))
      .sort((a, b) => b.views - a.views),
    items,
  };
}

type Report = ReturnType<typeof buildOrderReport>;

/**
 * CSV для Excel: `;` и BOM — иначе русская Excel склеит колонки и сломает кириллицу. Имя креатора
 * пишет он сам, поэтому ячейки, похожие на формулу (=, +, -, @), экранируем апострофом.
 */
export function reportCsv(report: Report): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    [
      tr('errors.csvCreator'),
      tr('errors.csvPlatform'),
      tr('errors.csvLink'),
      tr('errors.csvViews'),
      tr('errors.csvLikes'),
      tr('errors.csvClicks'),
      tr('errors.csvApproved'),
    ],
    ...report.items.map((i) => [
      i.creator,
      i.platform === 'OTHER'
        ? tr('errors.csvOther')
        : PLATFORMS[i.platform].name,
      i.videoUrl ?? '',
      i.views,
      i.likes ?? '',
      i.clicks ?? '',
      i.approvedAt ? i.approvedAt.toISOString().slice(0, 10) : '',
    ]),
  ];
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
