// Telegram caps a single message at 4096 characters; these limits keep any one field
// well within that even after it's wrapped in a formatted card alongside other fields.
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_PRICE_LENGTH = 50;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_URL_LENGTH = 500;
export const MAX_DEADLINE_DAYS = 365;
