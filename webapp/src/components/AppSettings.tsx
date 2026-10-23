import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMe, updateLanguage } from '../api';
import { LANG_NAMES, LANGS, type Lang } from '../i18n';
import { setThemePref, themePref, type ThemePref } from '../telegram';
import s from './AppSettings.module.css';

// Тема — только для этого устройства (localStorage), как и сам выбор в Telegram.
const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'auto', label: 'settings.themeAuto' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];

// Язык — на сервере (User.language): на нём же пишет бот. auto — по языку Telegram.
type LangPref = Lang | 'auto';

/** Оформление и язык — одинаковые в профиле креатора и заказчика. */
export default function AppSettings() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePref>(themePref);
  const [langPref, setLangPref] = useState<LangPref>();
  const [langError, setLangError] = useState('');

  useEffect(() => {
    fetchMe()
      .then((me) => setLangPref(me.languageChosen ? me.language : 'auto'))
      .catch(() => {});
  }, []);

  function pickTheme(pref: ThemePref) {
    setTheme(pref);
    setThemePref(pref);
  }

  async function pickLang(pref: LangPref) {
    setLangError('');
    try {
      await updateLanguage(pref === 'auto' ? null : pref);
      setLangPref(pref);
      await fetchMe(); // применит новый язык
    } catch {
      setLangError(t('settings.languageError'));
    }
  }

  return (
    <>
      <section className={s.block}>
        <h2 id="theme-label" className="section-title">
          {t('settings.themeTitle')}
        </h2>
        <div
          className={s.segmented}
          role="radiogroup"
          aria-labelledby="theme-label"
        >
          {THEMES.map((th) => (
            <button
              key={th.value}
              type="button"
              role="radio"
              aria-checked={theme === th.value}
              onClick={() => pickTheme(th.value)}
            >
              {t(th.label)}
            </button>
          ))}
        </div>
      </section>

      <section className={s.block}>
        <h2 id="lang-label" className="section-title">
          {t('settings.languageTitle')}
        </h2>
        <div
          className={s.segmented}
          role="radiogroup"
          aria-labelledby="lang-label"
        >
          <button
            type="button"
            role="radio"
            aria-checked={langPref === 'auto'}
            onClick={() => pickLang('auto')}
          >
            {t('settings.languageAuto')}
          </button>
          {/* названия языков — на самих языках: найдёт и тот, кто не понимает текущий */}
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              lang={l}
              aria-checked={langPref === l}
              onClick={() => pickLang(l)}
            >
              {LANG_NAMES[l]}
            </button>
          ))}
        </div>
        {langError && (
          <p className={s.error} role="alert">
            {langError}
          </p>
        )}
      </section>
    </>
  );
}
