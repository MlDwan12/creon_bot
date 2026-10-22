import type { PrismaService } from '../prisma/prisma.service';
import type { OrdersService } from '../orders/orders.service';
import type { SubmissionsService } from '../submissions/submissions.service';
import type { NotificationsService } from '../telegram/notifications.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { ViewCounterService } from '../submissions/view-counter.service';
import { ScheduledJob } from './scheduled.job';

describe('итог холда без модератора', () => {
  it('ролики заблокированного креатора не выпускает — их решает модератор', async () => {
    const due = [
      {
        id: 1,
        videoUrl: 'https://youtu.be/aaaaaaaaaaa',
        creatorId: 1,
        views: 1,
        creator: { bannedAt: null },
      },
      {
        id: 2,
        videoUrl: 'https://youtu.be/bbbbbbbbbbb',
        creatorId: 2,
        views: 1,
        creator: { bannedAt: new Date() },
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
