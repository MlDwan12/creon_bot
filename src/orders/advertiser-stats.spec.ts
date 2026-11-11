import type { Order, Submission, User } from '@prisma/client';
import { buildAdvertiserStats, statsCsv } from './advertiser-stats';

const order = (id: number, targetUrl: string | null) =>
  ({
    id,
    title: `Заказ ${id}`,
    status: 'OPEN',
    budgetMinor: 5_000_000,
    feePercent: 20,
    targetUrl,
  }) as Order;

const video = (
  id: number,
  orderId: number,
  url: string,
  views: number,
  payoutMinor: number,
  creatorId = 7,
) =>
  ({
    id,
    orderId,
    videoUrl: url,
    trackCode: `c${id}`,
    clicks: 10,
    views,
    likes: null,
    payoutMinor,
    creatorId,
    decidedAt: new Date('2026-11-08T10:00:00Z'),
    creator: { id: creatorId, firstName: 'Аня', username: 'anya' },
  }) as unknown as Submission & { creator: User };

describe('buildAdvertiserStats', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const since = new Date('2026-11-07T12:00:00Z');
  const stats = buildAdvertiserStats(
    [order(1, 'https://shop.example'), order(2, null)],
    [
      video(1, 1, 'https://www.tiktok.com/@a/video/1', 1000, 8_000),
      video(2, 2, 'https://youtu.be/x', 3000, 24_000, 8),
    ],
    [
      // до периода: в график не идёт, но поднимает планку ролика
      { submissionId: 1, views: 500, at: new Date('2026-11-01T10:00:00Z') },
      { submissionId: 1, views: 800, at: new Date('2026-11-08T10:00:00Z') },
      // замер ниже прошлого не вычитается
      { submissionId: 1, views: 700, at: new Date('2026-11-09T10:00:00Z') },
      { submissionId: 1, views: 1000, at: new Date('2026-11-10T10:00:00Z') },
      { submissionId: 2, views: 3000, at: new Date('2026-11-09T10:00:00Z') },
    ],
    since,
    now,
  );

  it('сводка: деньги с комиссией, переходы — только по заказам со ссылкой', () => {
    expect(stats.summary).toEqual({
      spent: 400, // (80 + 240) / 0.8
      views: 4000,
      likes: 0,
      clicks: 10,
      clickRate: 1, // 10 переходов на 1000 просмотров заказа со ссылкой
      videos: 2,
      creators: 2,
      cpm: 100,
    });
  });

  it('прирост по дням периода', () => {
    expect(stats.daily).toEqual([
      { date: '2026-11-07', views: 0 },
      { date: '2026-11-08', views: 300 },
      { date: '2026-11-09', views: 3000 },
      { date: '2026-11-10', views: 200 },
    ]);
  });

  it('заказы и площадки — больше просмотров выше, с ценой 1000 просмотров', () => {
    expect(stats.orders.map((o) => [o.id, o.spent, o.cpm, o.clicks])).toEqual([
      [2, 300, 100, null],
      [1, 100, 100, 10],
    ]);
    expect(stats.platforms.map((p) => [p.platform, p.views, p.cpm])).toEqual([
      ['YOUTUBE', 3000, 100],
      ['TIKTOK', 1000, 100],
    ]);
  });

  it('ролики — без ника автора, CSV — с колонкой заказа', () => {
    expect(stats.videos[0]).toMatchObject({
      orderTitle: 'Заказ 2',
      creatorId: 8,
      views: 3000,
      clicks: null,
    });
    expect(stats.videos[0].creator).not.toContain('anya');
    expect(statsCsv(stats).split('\r\n')).toHaveLength(3);
  });
});
