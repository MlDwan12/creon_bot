import type { Order, Submission, User } from '@prisma/client';
import { buildOrderReport, reportCsv } from './order-report';

const order = {
  id: 1,
  title: 'Заказ',
  status: 'OPEN',
  budgetMinor: 5_000_000, // 50 000 USDT
  feePercent: 20,
} as Order;

let nextId = 1;
const video = (
  status: Submission['status'],
  url: string,
  views: number,
  payoutMinor: number,
  creator: Partial<User> = {},
  likes: number | null = null,
) =>
  ({
    id: nextId++,
    status,
    videoUrl: url,
    views,
    likes,
    payoutMinor,
    creatorId: creator.id ?? 7,
    rating: null,
    decidedAt: new Date('2026-10-01T10:00:00Z'),
    creator: { id: 7, firstName: 'Аня', username: 'anya', ...creator },
  }) as Submission & { creator: User };

describe('buildOrderReport', () => {
  const report = buildOrderReport(order, [
    video(
      'MODERATOR_APPROVED',
      'https://www.tiktok.com/@a/video/1',
      1000,
      8_000,
      {},
      50,
    ),
    video('MODERATOR_APPROVED', 'https://youtu.be/x', 3000, 24_000, { id: 8 }),
    video('SUBMITTED', 'https://youtu.be/w', 2000, 0, {}, 999),
    video('SUBMITTED', 'https://youtu.be/y', 2000, 16_000),
    video('MODERATOR_REJECTED', 'https://youtu.be/z', 9000, 0),
  ]);

  it('сводка — со стороны рекламодателя: выплаты вместе с комиссией', () => {
    expect(report.summary).toEqual({
      budget: 50_000,
      spent: 400, // 320 USDT креаторам / 0,8
      reserved: 200,
      left: 49_400,
      views: 4000,
      likes: 50, // лайки ролика на проверке и неизвестные (null) не считаются
      videos: 2,
      creators: 2,
      cpm: 100,
    });
  });

  it('ролики — только одобренные, больше просмотров выше; площадки по ссылке', () => {
    expect(report.items.map((i) => [i.platform, i.views, i.likes])).toEqual([
      ['YOUTUBE', 3000, null],
      ['TIKTOK', 1000, 50],
    ]);
    expect(report.platforms).toEqual([
      { platform: 'YOUTUBE', videos: 1, views: 3000 },
      { platform: 'TIKTOK', videos: 1, views: 1000 },
    ]);
  });

  it('рекламодателю — имя без @username и без сумм креатору', () => {
    const json = JSON.stringify(report);
    expect(json).not.toContain('anya');
    expect(json).not.toContain('payout');
  });
});

describe('reportCsv', () => {
  it('BOM, «;», кавычки и формулы в именах экранированы', () => {
    const csv = reportCsv(
      buildOrderReport(order, [
        video('MODERATOR_APPROVED', 'https://vk.com/clip1', 500, 4_000, {
          firstName: '=HYPERLINK("x")',
        }),
      ]),
    );
    expect(csv.startsWith('﻿"Креатор";"Площадка"')).toBe(true);
    expect(csv).toContain(
      `"'=HYPERLINK(""x"")";"VK";"https://vk.com/clip1";"500";"";"2026-10-01"`,
    );
  });
});
