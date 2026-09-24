import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { ModeratorGuard } from './moderator.guard';

/** Кто открыл Mini App — чтобы показать модератору его отдельное окно. Права всё равно проверяет каждый эндпоинт. */
@Controller('api/me')
@UseGuards(InitDataGuard)
export class MeController {
  constructor(private readonly moderatorGuard: ModeratorGuard) {}

  @Get()
  me(@Req() req: ApiRequest) {
    return { isModerator: this.moderatorGuard.isModerator(req.user) };
  }
}
