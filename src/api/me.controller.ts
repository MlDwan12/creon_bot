import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SupportService } from '../bot/support.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { ModeratorGuard } from './moderator.guard';

/**
 * Кто открыл Mini App: модератору — его отдельное окно, без username — предупреждение до заполнения
 * формы заказа; ссылка на чат с ботом для поддержки (null — выключена). Права проверяет каждый эндпоинт.
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
      hasUsername: Boolean(req.user.username),
      // самой поддержке кнопка «Поддержка» ни к чему — ей пишут в её же чат
      supportUrl: this.support.isSupportChat(req.user.telegramId)
        ? null
        : await this.support.url(),
    };
  }
}
