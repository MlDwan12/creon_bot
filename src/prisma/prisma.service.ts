import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get<string>('DATABASE_URL'),
        // Зависшая база (жива, но не отвечает) без таймаутов держит запросы вечно: они копятся,
        // пул соединений забивается, а контейнер упирается в память. С ними — быстрый 500 и
        // само восстановление, когда база отвиснет.
        connectionTimeoutMillis: 5_000, // ждать свободное соединение из пула или подключение
        query_timeout: 10_000, // ждать ответ на запрос (самые тяжёлые — аналитика — в разы быстрее)
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Не onModuleDestroy: модуль глобальный, и Nest мог бы закрыть базу раньше, чем очередь
  // уведомлений (NotificationsService.onModuleDestroy) дошлёт сообщения — им нужна проверка бана.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
