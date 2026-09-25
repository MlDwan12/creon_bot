import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { join } from 'node:path';
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new RedactingLogger(),
  });
  // не подсказываем снаружи, на чём сервер
  app.disable('x-powered-by');
  serveWebapp(app);
  // На SIGTERM (docker stop / редеплой) останавливает polling и закрывает соединение Prisma.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

/**
 * В проде собранный мини-апп лежит в public/ (см. Dockerfile), и Nest отдаёт его с того же адреса,
 * что и /api. В dev папки нет: фронт отдаёт Vite.
 */
function serveWebapp(app: NestExpressApplication) {
  const dir = join(__dirname, '..', 'public');
  if (!existsSync(dir)) return;
  app.useStaticAssets(dir);
  // Роутер фронта на History API: /orders/5 — не файл, а экран, поэтому на такие пути отдаём index.html.
  // Пути с точкой — отсутствующие файлы, им честный 404.
  const index = join(dir, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api') &&
      !req.path.includes('.')
    )
      return res.sendFile(index);
    next();
  });
}
