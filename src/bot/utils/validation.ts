// Telegram caps a single message at 4096 characters; these limits keep any one field
// well within that even after it's wrapped in a formatted card alongside other fields.
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_PRICE_LENGTH = 50;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_URL_LENGTH = 500;
export const MAX_DEADLINE_DAYS = 365;

// Отсекает заглушки вроде "-", "..." или одних пробелов — формально непустая строка,
// но не осмысленный текст. Требует хотя бы одну букву или цифру (любой алфавит).
const MEANINGFUL_TEXT_RE = /[\p{L}\p{N}]/u;

export function isMeaningfulText(value: string): boolean {
  return MEANINGFUL_TEXT_RE.test(value);
}
