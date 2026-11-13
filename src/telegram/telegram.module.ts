import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AuthModule } from '../auth/auth.module';
import { devGate } from '../auth/dev-access';
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
        // запускает StartUpdate.launch: сам модуль не ждёт запуск и не видит, что polling встал
        launchOptions: false,
        // закрытый дев-стенд (DEV_ALLOWED_IDS): чужим бот отвечает «тестовый стенд»
        middlewares: [devGate(config)],
      }),
    }),
    SupportModule,
    // вход на сайт кодом: бот выдаёт код по ссылке t.me/<бот>?start=login_<токен>
    AuthModule,
  ],
  providers: [NotificationsService, TelegramPhotosService, StartUpdate],
  exports: [NotificationsService, TelegramPhotosService],
})
export class TelegramModule {}
