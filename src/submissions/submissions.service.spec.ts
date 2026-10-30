import type { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from './submissions.service';
import type { ViewCounterService } from './view-counter.service';

describe('пример ролика заказа /v/e', () => {
  const service = (status: string) =>
    new SubmissionsService(
      {
        order: {
          findFirst: () =>
            Promise.resolve({
              exampleUrls: ['https://youtu.be/aaaaaaaaaaa'],
              status,
            }),
        },
      } as unknown as PrismaService,
      {} as ViewCounterService,
    );

  it('ведёт по примеру опубликованного заказа', async () => {
    expect(await service('OPEN').exampleUrl(7, 1)).toBe(
      'https://youtu.be/aaaaaaaaaaa',
    );
    expect(await service('OPEN').exampleUrl(7, 2)).toBeNull();
  });

  it.each(['PENDING_MODERATION', 'EDIT_REJECTED', 'REJECTED'])(
    'не ведёт по неодобренной правке: %s',
    async (status) => {
      expect(await service(status).exampleUrl(7, 1)).toBeNull();
    },
  );
});

describe('оценка ролика', () => {
  it('снятую модератором оценку не ставят заново', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const service = new SubmissionsService(
      {
        submission: {
          findUnique: () =>
            Promise.resolve({ id: 1, order: { advertiserId: 9 } }),
          updateMany,
        },
      } as unknown as PrismaService,
      {} as ViewCounterService,
    );
    await expect(
      service.rate(1, 9, { rating: 5, review: null, portfolioAllowed: false }),
    ).rejects.toThrow();
    const [[{ where }]] = updateMany.mock.calls as unknown as [
      [{ where: Record<string, unknown> }],
    ];
    expect(where).toMatchObject({ rating: null, reviewRemovedAt: null });
  });
});
