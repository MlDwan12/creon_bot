import type { User } from '@prisma/client';
import type { ApiRequest } from './init-data.guard';
import { MeController } from './me.controller';
import type { ModeratorGuard } from './moderator.guard';
import type { SupportService } from '../support/support.service';

describe('GET /api/me: комиссия', () => {
  it('не отдаётся ни в одном кабинете — пока размер не решён', async () => {
    const me = new MeController(
      { isModerator: () => false } as unknown as ModeratorGuard,
      { url: () => Promise.resolve(null) } as unknown as SupportService,
    );
    for (const cabinet of ['CREATOR', 'ADVERTISER', null] as User['cabinet'][])
      expect(
        await me.me({
          user: { cabinet, language: null } as User,
        } as ApiRequest),
      ).not.toHaveProperty('feePercent');
  });
});
