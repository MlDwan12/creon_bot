// Telegram caps a single message at 4096 characters; these limits keep any one field
// well within that even after it's wrapped in a formatted card alongside other fields.
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
/** Цена за видео в рублях. */
export const MAX_PRICE = 1_000_000;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_URL_LENGTH = 500;
export const MAX_DEADLINE_DAYS = 365;

// Ссылка на готовое видео.
export const VIDEO_URL_RE = /^https?:\/\/\S+$/i;

// Отсекает заглушки вроде "-", "..." или одних пробелов — формально непустая строка,
// но не осмысленный текст. Требует хотя бы одну букву или цифру (любой алфавит).
const MEANINGFUL_TEXT_RE = /[\p{L}\p{N}]/u;

export function isMeaningfulText(value: string): boolean {
  return MEANINGFUL_TEXT_RE.test(value);
}

/** id в базе — Int (до 2³¹−1): число больше Prisma не примет и упадёт с 500 вместо понятного ответа. */
const MAX_DB_ID = 2_147_483_647;

export function isDbId(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_DB_ID
  );
}
