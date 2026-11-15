/** Перевод приложения: i18next `t` сайта или мини-аппа. */
type Translate = (key: string, options?: Record<string, unknown>) => string;
type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Текст ошибки поля по его ValidityState — на языке приложения. `validationMessage` браузера
 * приходит на языке браузера, а не выбранном на сайте. Правила те же: required, min, max, step, type="url".
 */
export function fieldErrorText(el: Field, t: Translate): string {
  const v = el.validity;
  if (v.valueMissing) return t('fieldErrors.required');
  if (v.badInput) return t('fieldErrors.number');
  if (v.typeMismatch && el.type === 'url') return t('fieldErrors.url');
  if (v.rangeUnderflow)
    return t('fieldErrors.min', { min: el.getAttribute('min') });
  if (v.rangeOverflow)
    return t('fieldErrors.max', { max: el.getAttribute('max') });
  if (v.stepMismatch) return t('fieldErrors.integer');
  return t('fieldErrors.invalid');
}

/**
 * Поле с ошибкой — `aria-invalid` и ссылка на текст ошибки под ним (`aria-describedby`): скринридер
 * читает ошибку вместе с полем, когда на него переходит фокус. Атрибуты ставим прямо в DOM —
 * React их у полей не рисует и не затрёт. `errorId` — id абзаца с ошибкой этого поля.
 */
export function markFieldErrors(
  fields: Field[],
  invalid: Field[],
  errorId: (fieldId: string) => string,
): void {
  for (const el of fields) {
    if (invalid.includes(el)) {
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', errorId(el.id));
    } else {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
  }
}

/** Форма заказа: id абзаца с ошибкой для поля — несколько полей делят одну строку ошибки. */
export function orderFieldErrorId(fieldId: string): string {
  if (fieldId.startsWith('example-')) return 'examples-error';
  if (fieldId === 'minDuration' || fieldId === 'maxDuration')
    return 'duration-error';
  if (['budget', 'minViews', 'maxPayout'].includes(fieldId))
    return 'budget-error';
  return `${fieldId}-error`;
}
