import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { UsersService } from '../users/users.service';
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
    @Res({ passthrough: true }) res: Response,
  ) {
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

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, COOKIE);
  }
}
