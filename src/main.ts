import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { AppModule } from './app.module';
import { RedactingLogger } from './common/redacting-logger';

// Node перебирает IPv6/IPv4-адреса хоста, давая каждому по 250 мс. Если IPv6 до Telegram
// не работает, а IPv4 медленный, не успевает ни один — getMe падает с ETIMEDOUT.
// На быстрой сети ничего не меняет: первый адрес отвечает раньше.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

// nestjs-telegraf fires `bot.launch()` without awaiting or catching it, so a
// transient network error talking to Telegram (e.g. getMe timing out) surfaces
// as an unhandled rejection — which Node treats as fatal and kills the process.
// Log it instead of crashing; Telegraf's own polling loop retries on its own.
process.on('unhandledRejection', (reason) => {
  Logger.error(reason, undefined, 'UnhandledRejection');
});

async function bootstrap() {
  // HTTP нужен для API Mini App (src/api); бот по-прежнему работает через long polling.
  const app = await NestFactory.create(AppModule, {
    logger: new RedactingLogger(),
  });
  // На SIGTERM (docker stop / редеплой) останавливает polling и закрывает соединение Prisma.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
