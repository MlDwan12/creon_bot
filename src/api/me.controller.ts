import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { ModeratorGuard } from './moderator.guard';

/**
 * Кто открыл Mini App: модератору — его отдельное окно, без username — предупреждение до заполнения
 * формы заказа; ссылка на поддержку (env SUPPORT_URL, необязательная). Права проверяет каждый эндпоинт.
 */
@Controller('api/me')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class MeController {
  private readonly supportUrl: string | null;

  constructor(
    private readonly moderatorGuard: ModeratorGuard,
    config: ConfigService,
  ) {
    this.supportUrl = config.get<string>('SUPPORT_URL') || null;
  }

  @Get()
  me(@Req() req: ApiRequest) {
    return {
      isModerator: this.moderatorGuard.isModerator(req.user),
      hasUsername: Boolean(req.user.username),
      supportUrl: this.supportUrl,
    };
  }
}
