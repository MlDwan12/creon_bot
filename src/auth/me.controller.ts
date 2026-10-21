import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { userLang } from '../i18n/i18n';
import { SupportService } from '../support/support.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { ModeratorGuard } from './moderator.guard';

/**
 * Кто открыл Mini App: модератору — его отдельное окно; supportUrl — ссылка на чат с ботом (null — поддержка выключена);
 * language — язык интерфейса; cabinet — кабинет, открытый последним (null — ещё не выбирал).
 * Права проверяет каждый эндпоинт.
 */
@Controller('api/me')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class MeController {
  constructor(
    private readonly moderatorGuard: ModeratorGuard,
    private readonly support: SupportService,
  ) {}

  @Get()
  async me(@Req() req: ApiRequest) {
    return {
      isModerator: this.moderatorGuard.isModerator(req.user),
      supportUrl: await this.support.url(),
      // язык интерфейса: выбранный в профиле или по Telegram; мини-апп переключается на него
      language: userLang(req.user),
      languageChosen: req.user.language !== null,
      cabinet: req.user.cabinet?.toLowerCase() ?? null,
    };
  }
}
