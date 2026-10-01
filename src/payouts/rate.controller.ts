import { Controller, Get, UseGuards } from '@nestjs/common';
import { InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { UsdtRateService } from './usdt-rate.service';

/** Курс USDT в рублях для подсказок «≈ … ₽»; null — сейчас неизвестен. */
@Controller('api/rate')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class RateController {
  constructor(private readonly rate: UsdtRateService) {}

  @Get()
  async get() {
    return { rub: await this.rate.rubPerUsdt() };
  }
}
