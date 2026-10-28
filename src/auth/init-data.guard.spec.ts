import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { SupportService } from '../support/support.service';
import type { UsersService } from '../users/users.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { SESSION_COOKIE, signSession } from './web-login.util';

const TOKEN = '123456:TEST-token';

describe('InitDataGuard: сессия сайта', () => {
  const user = { id: 7, bannedAt: null, language: 'ru' } as User;
  const guard = new InitDataGuard(
    { get: () => TOKEN } as unknown as ConfigService,
    {
      findById: (id: number) => Promise.resolve(id === 7 ? user : null),
    } as unknown as UsersService,
    {} as SupportService,
  );
  const authDate = Math.floor(Date.now() / 1000) - 60;
  const cookie = `${SESSION_COOKIE}=${signSession(7, authDate, TOKEN)}`;
  const run = (headers: Record<string, string>) => {
    const req = { headers } as unknown as ApiRequest;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
    return guard.canActivate(ctx).then(() => req);
  };

  it('пускает по cookie со своим заголовком', async () => {
    const req = await run({ cookie, 'x-fixum-web': '1' });
    expect(req.user).toBe(user);
    expect(req.authDate).toBe(authDate);
  });

  it('без заголовка cookie не считается (CSRF), чужая подпись — тоже', async () => {
    await expect(run({ cookie })).rejects.toThrow('Unauthorized');
    await expect(
      run({
        cookie: `${SESSION_COOKIE}=${signSession(7, authDate, '1:other')}`,
        'x-fixum-web': '1',
      }),
    ).rejects.toThrow('Unauthorized');
  });
});
