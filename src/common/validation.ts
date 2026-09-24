// Telegram caps a single message at 4096 characters; these limits keep any one field
// well within that even after it's wrapped in a formatted card alongside other fields.
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
/** Цена за видео в рублях. */
export const MAX_PRICE = 1_000_000;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_URL_LENGTH = 500;
export const MAX_DEADLINE_DAYS = 365;

// Ссылка на готовое видео — проверяется и в сцене бота, и в API Mini App.
export const VIDEO_URL_RE = /^https?:\/\/\S+$/i;

// Отсекает заглушки вроде "-", "..." или одних пробелов — формально непустая строка,
// но не осмысленный текст. Требует хотя бы одну букву или цифру (любой алфавит).
const MEANINGFUL_TEXT_RE = /[\p{L}\p{N}]/u;

export function isMeaningfulText(value: string): boolean {
  return MEANINGFUL_TEXT_RE.test(value);
}
