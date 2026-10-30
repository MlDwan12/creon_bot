import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { UsersService } from '../users/users.service';
import { WebLoginService } from './web-login.service';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  validateLoginWidget,
} from './web-login.util';

/** Данные виджета принимаем не старше суток — как initData мини-аппа. */
const LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;

// только для API: страницам сайта cookie не нужна. Strict — с чужих сайтов браузер её не пошлёт.
const COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api',
} as const;

/**
 * Вход на сайт через Telegram Login Widget: проверяем подпись данных виджета и ставим cookie сессии,
 * дальше все эндпоинты API пускает InitDataGuard — как мини-апп, но по cookie.
 * Лимит запросов — nginx (подделать подпись перебором всё равно нельзя).
 */
@Controller('api/web')
export class WebAuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly webLogin: WebLoginService,
  ) {}

  /**
   * id бота для окна входа Telegram (Telegram.Login.auth): у прода и дев-стенда боты разные, а сборка
   * сайта — одна. id — часть токена до двоеточия, не секрет.
   */
  @Get('config')
  webConfig() {
    return {
      botId: Number(this.config.get<string>('BOT_TOKEN')!.split(':')[0]),
    };
  }

  @Post('login')
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Headers('x-fixum-web') web: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // тот же заголовок, что для cookie (InitDataGuard): без него чужая страница отправила бы форму
    // входа с чужими данными виджета, и жертва работала бы под аккаунтом того, кто её подсунул
    if (web !== '1') throw new ForbiddenException();
    const token = this.config.get<string>('BOT_TOKEN')!;
    const login = validateLoginWidget(body, token, LOGIN_MAX_AGE_SECONDS);
    if (!login) throw new UnauthorizedException();
    // язык виджет не присылает — останется тот, что знаем по мини-аппу
    const user = await this.users.findOrCreate({
      telegramId: BigInt(login.user.id),
      username: login.user.username,
      firstName: login.user.first_name,
    });
    res.cookie(SESSION_COOKIE, signSession(user.id, login.authDate, token), {
      ...COOKIE,
      maxAge: SESSION_MAX_AGE_SECONDS * 1000,
    });
  }

  /** Вход кодом из бота, шаг 1: одноразовая ссылка на бота (WebLoginService). */
  @Post('login/start')
  startCodeLogin(@Headers('x-fixum-web') web: string | undefined) {
    if (web !== '1') throw new ForbiddenException();
    return this.webLogin.start();
  }

  /** Шаг 2: код, который бот прислал в Telegram, — ставим ту же сессию, что и вход через виджет. */
  @Post('login/code')
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
