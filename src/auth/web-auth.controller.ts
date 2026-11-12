import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { WebLoginService } from './web-login.service';
import {
  checkState,
  finishOidc,
  OIDC_CALLBACK_PATH,
  OIDC_COOKIE,
  type OidcConfig,
  startOidc,
} from './oidc.util';
import {
  readCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
} from './web-login.util';

// только для API: страницам сайта cookie не нужна. Strict — с чужих сайтов браузер её не пошлёт.
const COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api',
} as const;

// state входа OIDC: lax — иначе браузер не пошлёт её при возврате с oauth.telegram.org
const OIDC_STATE_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/web/oidc',
  maxAge: 10 * 60_000,
} as const;

/**
 * Вход на сайт: через OpenID Connect Telegram (oidc.util.ts) или кодом из бота (WebLoginService) —
 * ставим cookie сессии, дальше все эндпоинты API пускает InitDataGuard — как мини-апп, но по cookie.
 * Лимит — по IP (пользователя до входа ещё нет): общий 60 в минуту, у входа — 20 в минуту.
 */
@Controller('api/web')
@UseGuards(ThrottlerGuard)
export class WebAuthController {
  private readonly logger = new Logger(WebAuthController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly webLogin: WebLoginService,
  ) {}

  /**
   * Настройки страницы входа: у прода и дев-стенда они разные, а сборка сайта — одна.
   * oidc — есть кнопка входа через Telegram (OpenID Connect). botUrl — ссылка «мини-приложение» под входом.
   */
  @Get('config')
  async webConfig() {
    return {
      oidc: this.oidc() !== null,
      // чат с ботом — из него открывается мини-апп; Telegram недоступен — без ссылки
      botUrl: await this.webLogin.username().then(
        (name) => `https://t.me/${name}`,
        () => null,
      ),
      // политика — страница мини-аппа, открывается и в обычном браузере (webapp/src/views/PrivacyView.tsx)
      privacyUrl: legalUrl('privacy'),
      termsUrl: legalUrl('terms'),
    };
  }

  /** Вход через OpenID Connect, шаг 1: уводим на Telegram, state и code_verifier — в cookie. */
  @Get('oidc/start')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  oidcStart(@Res() res: Response) {
    const config = this.oidc();
    if (!config) return res.redirect(this.siteUrl(true));
    const { url, cookie } = startOidc(config);
    res.cookie(OIDC_COOKIE, cookie, OIDC_STATE_COOKIE);
    res.redirect(url);
  }

  /**
   * Шаг 2: Telegram вернул code — меняем на id_token, ставим ту же сессию, что и вход кодом.
   * От подмены входа (CSRF) защищает state: он должен совпасть с cookie этого браузера,
   * заголовок X-Fixum-Web при редиректе не передать. Любая ошибка — на сайт с ?login_error=1.
   */
  @Get('oidc/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async oidcCallback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const config = this.oidc();
    const verifier = checkState(
      readCookie(req.headers.cookie, OIDC_COOKIE),
      state,
    );
    res.clearCookie(OIDC_COOKIE, OIDC_STATE_COOKIE);
    if (!config || !verifier || typeof code !== 'string' || !code)
      return res.redirect(this.siteUrl(true));
    const login = await finishOidc(config, code, verifier).catch(
      (err: unknown) => {
        this.logger.warn(`Вход OIDC: ${String(err)}`);
        return null;
      },
    );
    if (!login) return res.redirect(this.siteUrl(true));
    const user = await this.users.findOrCreate({
      telegramId: BigInt(login.id),
      username: login.username,
      firstName: login.firstName,
    });
    // свежесть входа (assertFreshLogin) — от момента возврата из Telegram
    const authDate = Math.floor(Date.now() / 1000);
    res.cookie(
      SESSION_COOKIE,
      signSession(user.id, authDate, this.config.get<string>('BOT_TOKEN')!),
      { ...COOKIE, maxAge: SESSION_MAX_AGE_SECONDS * 1000 },
    );
    res.redirect(this.siteUrl(false));
  }

  /** Настройки OIDC; не заданы (TELEGRAM_OIDC_* или WEB_URL) — на сайте только вход кодом. */
  private oidc(): OidcConfig | null {
    const clientId = this.config.get<string>('TELEGRAM_OIDC_CLIENT_ID');
    const clientSecret = this.config.get<string>('TELEGRAM_OIDC_CLIENT_SECRET');
    const web = this.config.get<string>('WEB_URL')?.replace(/\/$/, '');
    if (!clientId || !clientSecret || !web) return null;
    return { clientId, clientSecret, redirectUri: web + OIDC_CALLBACK_PATH };
  }

  private siteUrl(error: boolean) {
    const web = (this.config.get<string>('WEB_URL') ?? '').replace(/\/$/, '');
    return `${web}/${error ? '?login_error=1' : ''}`;
  }

  /** Вход кодом из бота, шаг 1: одноразовая ссылка на бота (WebLoginService). */
  @Post('login/start')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  startCodeLogin(@Headers('x-fixum-web') web: string | undefined) {
    if (web !== '1') throw new ForbiddenException();
    return this.webLogin.start();
  }

  /** Шаг 2: код, который бот прислал в Telegram, — ставим сессию. */
  @Post('login/code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(204)
  async codeLogin(
    @Body() body: { token?: unknown; code?: unknown } | undefined,
    @Headers('x-fixum-web') web: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (web !== '1') throw new ForbiddenException();
    const token = typeof body?.token === 'string' ? body.token : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const userId = await this.webLogin.verify(token, code);
    // свежесть входа (assertFreshLogin) — от момента ввода кода
    const authDate = Math.floor(Date.now() / 1000);
    res.cookie(
      SESSION_COOKIE,
      signSession(userId, authDate, this.config.get<string>('BOT_TOKEN')!),
      { ...COOKIE, maxAge: SESSION_MAX_AGE_SECONDS * 1000 },
    );
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, COOKIE);
  }
}

/** Юридическая страница мини-аппа (/privacy, /terms); без WEBAPP_URL — null. */
function legalUrl(page: string) {
  const app = process.env.WEBAPP_URL?.replace(/\/$/, '');
  return app ? `${app}/${page}` : null;
}
