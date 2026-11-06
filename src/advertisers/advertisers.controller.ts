import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { ModeratorGuard } from '../auth/moderator.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { SupportService } from '../support/support.service';
import { NotificationsService } from '../telegram/notifications.service';
import { parseApplication } from './advertiser-input';
import { AdvertisersService } from './advertisers.service';

/** Заявка «Стать заказчиком» из профиля. Состояние кнопки — в GET /api/profile (`advertiser`). */
@Controller('api/advertiser')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class AdvertisersController {
  constructor(
    private readonly advertisers: AdvertisersService,
    private readonly moderatorGuard: ModeratorGuard,
    private readonly support: SupportService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('application')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  async apply(@Body() body: unknown, @Req() req: ApiRequest) {
    const app = await this.advertisers.apply(
      req.user,
      this.moderatorGuard.isModerator(req.user),
      parseApplication(body),
    );
    this.support.advertiserApplication(req.user, app.email, app.phone);
    this.notifications.advertiserApplied(req.user);
    return { ok: true };
  }
}
