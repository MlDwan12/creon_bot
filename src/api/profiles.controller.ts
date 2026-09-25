import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Put,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';
import { TelegramPhotosService } from '../bot/telegram-photos.service';
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
    private readonly photos: TelegramPhotosService,
  ) {}

  /** Свой профиль креатора. */
  @Get('profile')
  async mine(@Req() req: ApiRequest) {
    return { ...(await this.profiles.profile(req.user.id, true)), ban: null };
  }

  /** Ссылки на соцсети в своём профиле. */
  @Put('profile/links')
  async updateLinks(@Body() body: unknown, @Req() req: ApiRequest) {
    await this.profiles.updateLinks(req.user.id, parseLinks(body));
    return { ok: true };
  }

  /** Профиль креатора — кому можно, решает ProfilesService.canView. */
  @Get('creators/:id')
  async creator(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    await this.mustView(req, id);
    const moderator = this.moderatorGuard.isModerator(req.user);
    const profile = await this.profiles.profile(
      id,
      moderator || id === req.user.id,
    );
    // причина блокировки — внутреннее дело модерации
    return moderator ? profile : { ...profile, ban: null };
  }

  /**
   * Фото из Telegram — тем же, кому виден профиль. Клиент кэширует на час: фото меняют редко,
   * а каждый запрос — два обращения к Bot API.
   */
  @Get('creators/:id/photo')
  @Header('Cache-Control', 'private, max-age=3600')
  async photo(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    await this.mustView(req, id);
    const telegramId = await this.profiles.telegramIdOf(id);
    const photo = telegramId && (await this.photos.profilePhoto(telegramId));
    if (!photo) throw new NotFoundException('Фото нет');
    return new StreamableFile(photo, { type: 'image/jpeg' });
  }

  private async mustView(req: ApiRequest, creatorId: number) {
    const allowed = await this.profiles.canView(
      req.user,
      creatorId,
      this.moderatorGuard.isModerator(req.user),
    );
    if (!allowed)
      throw new ForbiddenException('Профиль этого креатора вам недоступен');
  }
}
