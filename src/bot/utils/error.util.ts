import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

/**
 * Пользователю можно показывать только наши собственные ForbiddenException/NotFoundException —
 * всё остальное (сырая ошибка Prisma/сети, баг) может раскрыть внутренние детали, поэтому
 * вместо этого показываем общий текст, а саму ошибку логируем через общий логгер приложения.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ForbiddenException || err instanceof NotFoundException) {
    return err.message;
  }
  Logger.error(err, undefined, 'BotUpdate');
  return 'Не удалось выполнить действие';
}
