import type { PrismaService } from '../prisma/prisma.service';
import type { OrdersService } from '../orders/orders.service';
import type { SubmissionsService } from '../submissions/submissions.service';
import type { NotificationsService } from '../telegram/notifications.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { ViewCounterService } from '../submissions/view-counter.service';
import { ScheduledJob } from './scheduled.job';

describe('итог холда без модератора', () => {
  it('ролики заблокированного и по заказам со ссылкой в шапке не выпускает — их решает модератор', async () => {
    const order = (linkInBio: boolean) => ({
      linkInBio,
      editedAt: null,
      prevTerms: null,
    });
    const due = [
      {
        id: 1,
        videoUrl: 'https://youtu.be/aaaaaaaaaaa',
        creatorId: 1,
        views: 1,
        creator: { bannedAt: null },
        order: order(false),
        terms: null,
        submittedAt: null,
      },
      {
        id: 2,
        videoUrl: 'https://youtu.be/bbbbbbbbbbb',
        creatorId: 2,
        views: 1,
        creator: { bannedAt: new Date() },
        order: order(false),
        terms: null,
        submittedAt: null,
      },
      {
        id: 3,
        videoUrl: 'https://youtu.be/ccccccccccc',
        creatorId: 3,
        views: 1,
        creator: { bannedAt: null },
        order: order(true),
        terms: null,
        submittedAt: null,
      },
      // ссылку убрали из заказа правкой после сдачи — ролик сдан на условиях со ссылкой
      {
        id: 4,
        videoUrl: 'https://youtu.be/ddddddddddd',
        creatorId: 4,
        views: 1,
        creator: { bannedAt: null },
        order: order(false),
        terms: { linkInBio: true },
        submittedAt: null,
      },
    ];
    const finalizeViews = jest.fn(() => Promise.resolve({}));
    const job = new ScheduledJob(
      {} as PrismaService,
      {} as OrdersService,
      {
        listHoldDue: () => Promise.resolve(due),
        finalizeViews,
      } as unknown as SubmissionsService,
      { viewsFinalized: jest.fn() } as unknown as NotificationsService,
      {} as PayoutsService,
      {
        isAutomatic: () => true,
        fetchViews: () =>
          Promise.resolve(
            new Map(due.map((s) => [s.videoUrl, { views: 10, likes: null }])),
          ),
      } as unknown as ViewCounterService,
    );

    await (
      job as unknown as { finalizeAutomatic(): Promise<void> }
    ).finalizeAutomatic();

    expect(finalizeViews.mock.calls.map((c: unknown[]) => c[0])).toEqual([1]);
  });
});
