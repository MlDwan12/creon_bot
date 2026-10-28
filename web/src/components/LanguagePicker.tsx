import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMe, updateLanguage } from '../api';
import { useSession } from '../session';
import s from '../ui.module.css';

const LANG_NAMES = { ru: 'Русский', en: 'English' } as const;

/** Язык интерфейса — в профилях заказчика и креатора. Хранится на сервере (User.language): на нём же пишет бот. */
export function LanguagePicker() {
  const { t } = useTranslation();
  const { me, setMe } = useSession();
  const [langError, setLangError] = useState('');

  /** null — снова по языку Telegram. */
  async function pickLang(lang: 'ru' | 'en' | null) {
    setLangError('');
    try {
      await updateLanguage(lang);
      setMe(await fetchMe()); // fetchMe применит новый язык
    } catch {
      setLangError(t('settings.languageError'));
    }
  }
  const langPref = me.languageChosen ? me.language : null;

  return (
    <section className={s.card}>
      <h2 id="lang-label">{t('settings.languageTitle')}</h2>
      <div className={s.chips} role="radiogroup" aria-labelledby="lang-label">
        <button
          type="button"
          role="radio"
          aria-checked={langPref === null}
          onClick={() => pickLang(null)}
        >
          {t('settings.languageAuto')}
        </button>
        {/* названия языков — на самих языках: найдёт и тот, кто не понимает текущий */}
        {(['ru', 'en'] as const).map((l) => (
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
  );
}
