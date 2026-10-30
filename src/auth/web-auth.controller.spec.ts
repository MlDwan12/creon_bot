import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { UsersService } from '../users/users.service';
import { WebAuthController } from './web-auth.controller';

describe('POST /api/web/login', () => {
  it('без заголовка X-Fixum-Web не входит: форма с чужой страницы не ставит cookie', async () => {
    const cookie = jest.fn();
    const controller = new WebAuthController(
      { get: () => '123:token' } as unknown as ConfigService,
      {} as UsersService,
    );
    await expect(
      controller.login({}, undefined, { cookie } as unknown as Response),
    ).rejects.toThrow(ForbiddenException);
    expect(cookie).not.toHaveBeenCalled();
  });
});
