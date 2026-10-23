import i18next, { type TFunction } from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Языки интерфейса. Словари — общие с мини-аппом: i18n/<язык>.json в корне репозитория. */
export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return LANGS.includes(value as Lang);
}

/** Язык из Telegram (language_code) → наш: русский — русский, всё остальное — английский. */
export function langFromTelegram(code: string | null | undefined): Lang {
  return code?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** Язык пользователя: выбранный в профиле, иначе — по языку Telegram. */
export function userLang(user: {
  language: string | null;
  telegramLanguage: string | null;
}): Lang {
  return isLang(user.language)
    ? user.language
    : langFromTelegram(user.telegramLanguage);
}

// Словари читаем один раз при старте: из корня проекта (в Docker — /app/i18n, см. Dockerfile).
const dir = join(process.cwd(), 'i18n');
const i18n = i18next.createInstance();
void i18n.init({
  resources: Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      {
        translation: JSON.parse(
          readFileSync(join(dir, `${lang}.json`), 'utf8'),
        ) as Record<string, unknown>,
      },
    ]),
  ),
  lng: 'ru',
  fallbackLng: 'en',
  // экранирование — там, где текст уходит в HTML (бот), а не здесь
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** Перевод на язык `lang`: `t('ru', 'errors.notFound', { id })`. */
export function translator(lang: Lang): TFunction {
  return i18n.getFixedT(lang);
}
