import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMe, fetchMyOrders, type MyOrder, updateLanguage } from '../api';
import { formatViews } from '../format';
import { useSession } from '../session';
import s from '../ui.module.css';

const LANG_NAMES = { ru: 'Русский', en: 'English' } as const;

/** Профиль заказчика: сводка по его рекламе и язык — как в мини-аппе (webapp/src/views/AccountView.tsx). */
export function Account() {
  const { t } = useTranslation();
  const { me, setMe } = useSession();
  const [orders, setOrders] = useState<MyOrder[]>();
  const [langError, setLangError] = useState('');
  // второстепенное: не загрузилось — просто не показываем
  useEffect(() => {
    fetchMyOrders().then(setOrders, () => {});
  }, []);

  /** Язык — на сервере (User.language): на нём же пишет бот. auto — по языку Telegram. */
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
    <div className={s.page}>
      <header>
        <h1>{me.firstName ?? t('tabs.profile')}</h1>
        <p className={s.hint}>{t('account.subtitle')}</p>
      </header>

      {!!orders?.length && (
        <div className={s.tiles}>
          <div className={s.tile}>
            <strong>
              {formatViews(orders.reduce((n, o) => n + o.views, 0))}
            </strong>
            <span>{t('account.views')}</span>
          </div>
          <div className={s.tile}>
            <strong>{orders.length}</strong>
            <span>{t('account.orders', { count: orders.length })}</span>
          </div>
          <div className={s.tile}>
            <strong>{orders.reduce((n, o) => n + o.approved, 0)}</strong>
            <span>
              {t('account.approved', {
                count: orders.reduce((n, o) => n + o.approved, 0),
              })}
            </span>
          </div>
        </div>
      )}

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
    </div>
  );
}
