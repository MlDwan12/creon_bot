import type { User } from '@prisma/client';
import type { ApiRequest } from './init-data.guard';
import { MeController } from './me.controller';
import type { ModeratorGuard } from './moderator.guard';
import type { SupportService } from '../support/support.service';

describe('GET /api/me: комиссия', () => {
  it('в кабинете креатора не отдаётся — по ней и остатку вычисляется бюджет', async () => {
    const me = new MeController(
      { isModerator: () => false } as unknown as ModeratorGuard,
      { url: () => Promise.resolve(null) } as unknown as SupportService,
    );
    const feeFor = async (cabinet: User['cabinet']) =>
      (await me.me({ user: { cabinet, language: null } as User } as ApiRequest))
        .feePercent;
    expect(await feeFor('CREATOR')).toBeNull();
    expect(await feeFor('ADVERTISER')).toBe(20);
  });
});
