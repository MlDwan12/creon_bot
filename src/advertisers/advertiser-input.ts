import { BadRequestException } from '@nestjs/common';
import { tr } from '../i18n/request-lang';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Международный формат: + и от 7 до 15 цифр; пробелы, скобки и дефисы убираем. */
const PHONE_RE = /^\+?\d{7,15}$/;

/** Заявка «Стать заказчиком»: почта обязательна, телефон по желанию (пусто — null). */
export function parseApplication(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))
    throw new BadRequestException(tr('errors.badEmail'));
  const phone =
    typeof b.phone === 'string' ? b.phone.replace(/[\s()-]/g, '') : '';
  if (phone && !PHONE_RE.test(phone))
    throw new BadRequestException(tr('errors.badPhone'));
  return { email, phone: phone || null };
}
