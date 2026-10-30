import type { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from './profiles.service';

describe('названия заказов в профиле креатора', () => {
  const row = (status: string) => ({
    id: 1,
    rating: 5,
    review: null,
    decidedAt: null,
    videoUrl: 'https://youtu.be/aaaaaaaaaaa',
    order: { title: 'Пишите @advertiser', advertiserId: 9, status },
  });
  const service = (status: string) =>
    new ProfilesService({
      user: {
        findUnique: () => Promise.resolve({ id: 5, socialLinks: [] }),
      },
      submission: {
        aggregate: () =>
          Promise.resolve({ _avg: { rating: 5 }, _count: { rating: 1 } }),
        count: () => Promise.resolve(1),
        findMany: () => Promise.resolve([row(status)]),
      },
    } as unknown as PrismaService);
  const titles = async (
    status: string,
    ...args: [boolean, number?, boolean?]
  ) => {
    const p = await service(status).profile(5, ...args);
    return [p.reviews[0].orderTitle, p.portfolio[0].orderTitle];
  };

  it('креатору — только прошедшие модерацию', async () => {
    for (const status of ['PENDING_MODERATION', 'EDIT_REJECTED', 'REJECTED'])
      expect(await titles(status, true, 5)).toEqual([null, null]);
    expect(await titles('OPEN', true, 5)).toEqual([
      'Пишите @advertiser',
      'Пишите @advertiser',
    ]);
  });

  it('модератору и своему заказчику — всегда', async () => {
    expect(await titles('EDIT_REJECTED', true, 1, true)).toEqual([
      'Пишите @advertiser',
      'Пишите @advertiser',
    ]);
    expect(await titles('EDIT_REJECTED', false, 9)).toEqual([
      'Пишите @advertiser',
      'Пишите @advertiser',
    ]);
  });
});
