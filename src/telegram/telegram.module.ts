import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { SupportModule } from '../support/support.module';
import { NotificationsService } from './notifications.service';
import { StartUpdate } from './start.update';
import { TelegramPhotosService } from './telegram-photos.service';

/** Бот — только вход в Mini App и уведомления. Вся работа с заказами — в мини-аппе. */
@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('BOT_TOKEN')!,
      }),
    }),
    SupportModule,
  ],
  providers: [NotificationsService, TelegramPhotosService, StartUpdate],
  exports: [NotificationsService, TelegramPhotosService],
})
export class TelegramModule {}
