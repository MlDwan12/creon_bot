import { BadRequestException } from '@nestjs/common';
import { tr } from '../i18n/request-lang';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Международный формат: + и от 7 до 15 цифр; пробелы, скобки и дефисы убираем. */
const PHONE_RE = /^\+?\d{7,15}$/;

/**
 * Редакция политики конфиденциальности (webapp/src/views/PrivacyView.tsx, «Редакция от …»), на которую
 * человек дал согласие в заявке. Меняется вместе с датой редакции в тексте политики.
 */
export const PRIVACY_VERSION = '13.11.2026';

/**
 * Заявка «Стать заказчиком»: почта обязательна, телефон по желанию (пусто — null), согласие на
 * обработку данных — обязательно (галочка в форме).
 */
export function parseApplication(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.consent !== true)
    throw new BadRequestException(tr('errors.consentRequired'));
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))
    throw new BadRequestException(tr('errors.badEmail'));
  const phone =
    typeof b.phone === 'string' ? b.phone.replace(/[\s()-]/g, '') : '';
  if (phone && !PHONE_RE.test(phone))
    throw new BadRequestException(tr('errors.badPhone'));
  return { email, phone: phone || null, consentVersion: PRIVACY_VERSION };
}
