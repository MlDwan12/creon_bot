import i18next from 'i18next';
// Словари — общие с бэкендом (бот, уведомления, ошибки): i18n/<язык>.json в корне репозитория.
// Вшиваются в сборку — тексты есть сразу, без запроса при запуске.
import en from '../../i18n/en.json';
import ru from '../../i18n/ru.json';
import { webApp } from './telegram';

export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English' };

const KEY = 'lang';

/**
 * Язык до ответа /api/me: прошлый запуск на этом устройстве, иначе язык Telegram (как решает
 * бэкенд — src/i18n/i18n.ts: русский только для ru). Потом /api/me скажет точно.
 */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // нет хранилища — по Telegram
  }
  const code = webApp?.initDataUnsafe?.user?.language_code ?? navigator.language;
  return code?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

void i18next.init({
  lng: initialLang(),
  fallbackLng: 'ru',
  resources: { ru: { translation: ru }, en: { translation: en } },
  // Vue сам экранирует {{ }} в шаблонах
  interpolation: { escapeValue: false },
  initAsync: false,
});
document.documentElement.lang = i18next.language;

/** Переключить язык интерфейса (и запомнить на устройстве — следующий запуск сразу на нём). */
export function setLang(lang: Lang) {
  void i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // не запомним — при запуске язык придёт с /api/me
  }
}

/** Локаль для чисел и дат: «1 234,5» по-русски, «1,234.5» по-английски. */
export function locale(): string {
  return i18next.language === 'en' ? 'en-US' : 'ru-RU';
}

export { i18next };
