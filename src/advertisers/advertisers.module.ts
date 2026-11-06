import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AdvertisersController } from './advertisers.controller';
import { AdvertisersService } from './advertisers.service';

/** Заявки в заказчики и кабинет заказчика (открыть / закрыть — в окне модератора). */
@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [AdvertisersController],
  providers: [AdvertisersService],
  exports: [AdvertisersService],
})
export class AdvertisersModule {}
