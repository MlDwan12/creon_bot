import { tr } from '../i18n/request-lang';
import { isLang, LANGS } from '../i18n/i18n';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NotificationsService } from '../telegram/notifications.service';
import { TelegramPhotosService } from '../telegram/telegram-photos.service';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { ModeratorGuard } from '../auth/moderator.guard';
import { parseWallet } from '../payouts/trc20';
import { parseLinks } from './profile-input';
import { ProfilesService } from './profiles.service';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';

@Controller('api')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly moderatorGuard: ModeratorGuard,
    private readonly photos: TelegramPhotosService,
    private readonly notifications: NotificationsService,
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

  /** Присылать ли сообщения о новых заказах. */
  @Put('profile/notifications')
  async updateNotifications(
    @Body('newOrders') newOrders: unknown,
    @Req() req: ApiRequest,
  ) {
    if (typeof newOrders !== 'boolean')
      throw new BadRequestException('newOrders — true или false');
    await this.profiles.updateNotifications(req.user.id, newOrders);
    return { ok: true };
  }

  /** Язык интерфейса и сообщений бота; null — снова по языку Telegram. */
  @Put('profile/language')
  async updateLanguage(
    @Body('language') language: unknown,
    @Req() req: ApiRequest,
  ) {
    if (language !== null && !isLang(language))
      throw new BadRequestException(`language — ${LANGS.join(', ')} или null`);
    await this.profiles.updateLanguage(req.user.id, language);
    return { ok: true };
  }

  /** Кошелёк USDT (TRC20) для выплат; пусто — убрать. Смена — уведомление владельцу. */
  @Put('profile/wallet')
  async updateWallet(@Body() body: unknown, @Req() req: ApiRequest) {
    const wallet = parseWallet(body);
    await this.profiles.updateWallet(req.user.id, wallet);
    if (wallet !== req.user.payoutWallet)
      this.notifications.walletChanged(req.user, wallet);
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
      req.user.id,
    );
    // причина блокировки — внутреннее дело модерации
    return moderator ? profile : { ...profile, ban: null };
  }

  /**
   * Фото из Telegram — тем же, кому виден профиль. Клиент кэширует на час: фото меняют редко,
   * а каждый запрос — два обращения к Bot API.
   */
  @Get('creators/:id/photo')
  async photo(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.mustView(req, id);
    const telegramId = await this.profiles.telegramIdOf(id);
    const photo = telegramId && (await this.photos.profilePhoto(telegramId));
    if (!photo) throw new NotFoundException(tr('errors.noPhoto'));
    // только на успех: @Header ставится до обработчика, и клиент на час запоминал бы 404,
    // полученный, пока Telegram был недоступен
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(photo, { type: 'image/jpeg' });
  }

  private async mustView(req: ApiRequest, creatorId: number) {
    const allowed = await this.profiles.canView(
      req.user,
      creatorId,
      this.moderatorGuard.isModerator(req.user),
    );
    if (!allowed) throw new ForbiddenException(tr('errors.creatorHidden'));
  }
}
