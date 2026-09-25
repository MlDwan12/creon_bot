import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from '../bot/notifications.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { ReportsService } from './reports.service';
import { UserThrottlerGuard } from './user-throttler.guard';

@Controller('api/reports')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Жалоба на заказ, видео, отзыв или профиль; модераторам — уведомление. */
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const what = await this.reports.create(req.user, this.reports.parse(body));
    this.notifications.reportCreated(what);
    return { ok: true };
  }
}
