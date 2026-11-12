import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { UsersService } from '../users/users.service';
import { WebAuthController } from './web-auth.controller';
import type { WebLoginService } from './web-login.service';

const env: Record<string, string> = {
  BOT_TOKEN: '123:token',
  WEB_URL: 'https://site.test',
  TELEGRAM_OIDC_CLIENT_ID: '123',
  TELEGRAM_OIDC_CLIENT_SECRET: 'secret',
};

function setup() {
  const res = {
    cookie: jest.fn<void, [string, string, object]>(),
    clearCookie: jest.fn(),
    redirect: jest.fn<void, [string]>(),
  };
  const findOrCreate = jest.fn();
  const controller = new WebAuthController(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    { findOrCreate } as unknown as UsersService,
    {} as WebLoginService,
  );
  return {
    controller,
    res,
    findOrCreate,
    response: res as unknown as Response,
  };
}

describe('вход через OIDC', () => {
  it('start уводит на Telegram и запоминает state в cookie', () => {
    const { controller, res, response } = setup();
    controller.oidcStart(response);
    const url = new URL(res.redirect.mock.calls[0][0]);
    expect(url.origin).toBe('https://oauth.telegram.org');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://site.test/api/web/oidc/callback',
    );
    expect(res.cookie.mock.calls[0][1]).toMatch(
      new RegExp(`^${url.searchParams.get('state')}\\.`),
    );
  });

  it('возврат с чужим state не входит: подсунутая ссылка не ставит сессию', async () => {
    const { controller, res, findOrCreate, response } = setup();
    await controller.oidcCallback(
      'code',
      'attacker-state',
      { headers: { cookie: 'fx_oidc=mine.verifier' } } as Request,
      response,
    );
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://site.test/?login_error=1',
    );
  });
});
