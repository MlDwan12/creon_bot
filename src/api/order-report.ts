import {
  type Order,
  type Submission,
  SubmissionStatus,
  type User,
} from '@prisma/client';
import { publicName } from '../bot/utils/format';
import { kopecksToRubles } from '../common/money';
import { type Platform, PLATFORMS, platformOf } from '../common/platforms';
import { budgetSpent } from '../orders/budget';

/**
 * Отчёт рекламодателю по заказу: сводка, площадки и одобренные ролики (больше просмотров — выше).
 * Деньги — со стороны рекламодателя: выплаты креаторам вместе с комиссией, в рублях. Сколько
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
      videoUrl: s.videoUrl,
      platform,
      creator: publicName(s.creator),
      creatorId: s.creatorId,
      views: s.views ?? 0,
      rating: s.rating,
      approvedAt: s.decidedAt,
    };
  });

  return {
    order: { id: order.id, title: order.title, status: order.status },
    summary: {
      budget: kopecksToRubles(order.budgetMinor),
      spent: kopecksToRubles(spent),
      /** Зарезервировано под ролики на проверке. */
      reserved: kopecksToRubles(reserved),
      left: kopecksToRubles(Math.max(0, order.budgetMinor - spent - reserved)),
      views,
      videos: approved.length,
      creators: new Set(approved.map((s) => s.creatorId)).size,
      /** Фактическая цена 1000 просмотров для рекламодателя; нет просмотров — null. */
      cpm: views ? kopecksToRubles(Math.round((spent * 1000) / views)) : null,
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
    ['Креатор', 'Площадка', 'Ссылка', 'Просмотры', 'Одобрено'],
    ...report.items.map((i) => [
      i.creator,
      i.platform === 'OTHER' ? 'Другое' : PLATFORMS[i.platform].name,
      i.videoUrl ?? '',
      i.views,
      i.approvedAt ? i.approvedAt.toISOString().slice(0, 10) : '',
    ]),
  ];
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
