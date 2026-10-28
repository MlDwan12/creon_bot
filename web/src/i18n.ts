import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
// Словари — общие с бэкендом и мини-аппом: i18n/<язык>.json в корне репозитория, тексты сайта — в web.*.
import en from '../../i18n/en.json';
import ru from '../../i18n/ru.json';

export type Lang = 'ru' | 'en';
const KEY = 'lang';

/** Язык до входа: прошлый визит, иначе язык браузера (русский — только для ru, как на бэкенде). */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // нет хранилища — по браузеру
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

void i18next.use(initReactI18next).init({
  lng: initialLang(),
  fallbackLng: 'en',
  resources: { ru: { translation: ru }, en: { translation: en } },
  // React сам экранирует текст в разметке
  interpolation: { escapeValue: false },
  initAsync: false,
});
document.documentElement.lang = i18next.language;

/** Язык из профиля (/api/me) — главнее догадки; запоминаем для следующего визита. */
export function setLang(lang: Lang) {
  if (lang === i18next.language) return;
  void i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // не запомним — после входа язык снова придёт с /api/me
  }
}

export { i18next };
