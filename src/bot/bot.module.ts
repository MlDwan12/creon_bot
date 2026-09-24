import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { NotificationsService } from './notifications.service';
import { SupportService } from './support.service';
import { TelegramPhotosService } from './telegram-photos.service';
import { StartUpdate } from './updates/start.update';

/** Бот — только вход в Mini App и уведомления. Вся работа с заказами — в мини-аппе (src/api). */
@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('BOT_TOKEN')!,
      }),
    }),
  ],
  providers: [
    NotificationsService,
    TelegramPhotosService,
    SupportService,
    StartUpdate,
  ],
  exports: [NotificationsService, TelegramPhotosService, SupportService],
})
export class BotModule {}
