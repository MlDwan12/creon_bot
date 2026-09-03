import { ConsoleLogger } from '@nestjs/common';

// Telegram bot tokens look like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
// Network errors from telegraf/node-fetch embed the full request URL (including
// the token) in their message/stack — e.g. "request to https://api.telegram.org/bot<TOKEN>/getMe failed".
// Scrub that pattern everywhere before it reaches stdout/log aggregation.
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

/** App-wide Nest logger that redacts bot-token-shaped substrings before printing. */
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
