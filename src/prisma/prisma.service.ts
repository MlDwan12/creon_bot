import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
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

  // Отключаться при остановке не нужно: после хуков Nest завершает процесс сам (повторно шлёт себе
  // сигнал), а отключение раньше времени оборвало бы досылку уведомлений — им нужна база.
}
