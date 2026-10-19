import { ConsoleLogger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

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

/** Одна и та же ошибка — в Sentry не чаще: упавшая база иначе выжгла бы месячную квоту за ночь. */
const SENTRY_REPEAT_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

/**
 * Ошибка из лога — в Sentry (без SENTRY_DSN — ничего не уходит): фоновые задачи, воркер уведомлений,
 * бот ловят свои ошибки и только пишут их в лог. Только Error, не строки. 500-е из HTTP Sentry уже
 * получил через свой фильтр, а потом Nest пишет их в лог с контекстом ExceptionsHandler — их пропускаем.
 */
function reportToSentry(args: unknown[]) {
  const err = args.find((a): a is Error => a instanceof Error);
  if (!err) return;
  // контекст Nest (имя сервиса) — последний строковый аргумент
  const context = args.findLast((a) => typeof a === 'string') ?? '';
  if (context === 'ExceptionsHandler') return;
  const key = `${context}:${err.name}:${err.message}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < SENTRY_REPEAT_MS) return;
  // ponytail: разные тексты ошибок копятся в карте — сбрасываем целиком, если разрослась
  if (lastSent.size > 1000) lastSent.clear();
  lastSent.set(key, now);
  Sentry.captureException(err, context ? { tags: { context } } : undefined);
}

/**
 * Логгер Nest на всё приложение, вычищающий из вывода подстроки, похожие на токен бота;
 * ошибки (`error` с Error) ещё и уходят в Sentry.
 */
export class RedactingLogger extends ConsoleLogger {
  log(message: unknown, ...optional: unknown[]) {
    super.log(redact(message), ...optional.map(redact));
  }

  error(message: unknown, ...optional: unknown[]) {
    const args = [message, ...optional].map(redact);
    super.error(...(args as [unknown, ...unknown[]]));
    reportToSentry(args);
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
