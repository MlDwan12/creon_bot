import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMe, updateLanguage } from '../api';
import { useSession } from '../session';
import s from '../ui.module.css';

const LANG_NAMES = { ru: 'Русский', en: 'English' } as const;

/**
 * Язык интерфейса — в профилях заказчика и креатора. Хранится на сервере (User.language): на нём же пишет бот.
 * Варианта «как в Telegram» на сайте нет: язык Telegram сайт не видит (его запоминают мини-апп и бот),
 * поэтому отмечен язык, на котором интерфейс сейчас.
 */
export function LanguagePicker() {
  const { t } = useTranslation();
  const { me, setMe } = useSession();
  const [langError, setLangError] = useState('');

  async function pickLang(lang: 'ru' | 'en') {
    setLangError('');
    try {
      await updateLanguage(lang);
      setMe(await fetchMe()); // fetchMe применит новый язык
    } catch {
      setLangError(t('settings.languageError'));
    }
  }

  return (
    <section className={s.card}>
      <h2 id="lang-label">{t('settings.languageTitle')}</h2>
      <div className={s.chips} role="radiogroup" aria-labelledby="lang-label">
        {/* названия языков — на самих языках: найдёт и тот, кто не понимает текущий */}
        {(['ru', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            lang={l}
            aria-checked={me.language === l}
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
