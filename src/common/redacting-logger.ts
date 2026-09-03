import { ConsoleLogger } from '@nestjs/common';

// Токен бота выглядит как `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
// Сетевые ошибки telegraf/node-fetch содержат полный URL запроса (вместе с токеном)
// в message/stack — например "request to https://api.telegram.org/bot<TOKEN>/getMe failed".
// Вычищаем этот паттерн везде, прежде чем он попадёт в stdout/агрегатор логов.
const TOKEN_PATTERN = /\d{6,}:[A-Za-z0-9_-]{30,}/g;

function redactString(text: string): string {
  return text.replace(TOKEN_PATTERN, '[REDACTED_BOT_TOKEN]');
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    const clone = Object.create(
      Object.getPrototypeOf(value) as object,
    ) as Error;
    Object.assign(clone, value);
    clone.message = redactString(value.message ?? '');
    if (value.stack) clone.stack = redactString(value.stack);
    return clone;
  }
  return value;
}

/** Логгер Nest на всё приложение, вычищающий из вывода подстроки, похожие на токен бота. */
export class RedactingLogger extends ConsoleLogger {
  log(message: unknown, ...optional: unknown[]) {
    super.log(redact(message), ...optional.map(redact));
  }

  error(message: unknown, ...optional: unknown[]) {
    super.error(redact(message), ...optional.map(redact));
  }

  warn(message: unknown, ...optional: unknown[]) {
    super.warn(redact(message), ...optional.map(redact));
  }

  debug(message: unknown, ...optional: unknown[]) {
    super.debug(redact(message), ...optional.map(redact));
  }

  verbose(message: unknown, ...optional: unknown[]) {
    super.verbose(redact(message), ...optional.map(redact));
  }
}
