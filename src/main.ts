import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedactingLogger } from './common/redacting-logger';

// nestjs-telegraf fires `bot.launch()` without awaiting or catching it, so a
// transient network error talking to Telegram (e.g. getMe timing out) surfaces
// as an unhandled rejection — which Node treats as fatal and kills the process.
// Log it instead of crashing; Telegraf's own polling loop retries on its own.
process.on('unhandledRejection', (reason) => {
  Logger.error(reason, undefined, 'UnhandledRejection');
});

// Бот работает через long polling, HTTP-сервер не нужен — только DI-контейнер.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new RedactingLogger(),
  });
  // На SIGTERM (docker stop / редеплой) останавливает polling и закрывает соединение Prisma.
  app.enableShutdownHooks();
}
void bootstrap();
