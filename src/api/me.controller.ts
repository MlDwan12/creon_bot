import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { ModeratorGuard } from './moderator.guard';

/**
 * Кто открыл Mini App: модератору — его отдельное окно, без username — предупреждение до заполнения
 * формы заказа. Права всё равно проверяет каждый эндпоинт.
 */
@Controller('api/me')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class MeController {
  constructor(private readonly moderatorGuard: ModeratorGuard) {}

  @Get()
  me(@Req() req: ApiRequest) {
    return {
      isModerator: this.moderatorGuard.isModerator(req.user),
      hasUsername: Boolean(req.user.username),
    };
  }
}
