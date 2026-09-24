import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { ModeratorGuard } from './moderator.guard';
import { parseLinks } from './profile-input';
import { ProfilesService } from './profiles.service';
import { UserThrottlerGuard } from './user-throttler.guard';

@Controller('api')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly moderatorGuard: ModeratorGuard,
  ) {}

  /** Свой профиль креатора. */
  @Get('profile')
  mine(@Req() req: ApiRequest) {
    return this.profiles.profile(req.user.id);
  }

  /** Ссылки на соцсети в своём профиле. */
  @Put('profile/links')
  async updateLinks(@Body() body: unknown, @Req() req: ApiRequest) {
    await this.profiles.updateLinks(req.user.id, parseLinks(body));
    return { ok: true };
  }

  /** Профиль креатора — кому можно, решает ProfilesService.canView. */
  @Get('creators/:id')
  async creator(@Param('id', ParseIntPipe) id: number, @Req() req: ApiRequest) {
    const allowed = await this.profiles.canView(
      req.user,
      id,
      this.moderatorGuard.isModerator(req.user),
    );
    if (!allowed)
      throw new ForbiddenException('Профиль этого креатора вам недоступен');
    return this.profiles.profile(id);
  }
}
