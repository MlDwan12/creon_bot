import type { Me } from '@fixum/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from './Login';
import s from './Shell.module.css';

type Cabinet = 'creator' | 'advertiser';

/**
 * Каркас кабинета: боковая панель (кабинет, кто вошёл, выход) и место под разделы.
 * Разделы модератора, заказчика и креатора — следующими шагами; пока — заглушка.
 */
export function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t } = useTranslation();
  const [cabinet, setCabinet] = useState<Cabinet>(me.cabinet ?? 'creator');
  const role = me.isModerator ? t('web.moderator') : t(`web.${cabinet}`);

  return (
    <div className={s.layout}>
      <aside className={s.nav}>
        <div className={s.head}>
          <Logo />
          {me.isModerator && (
            <span className={s.badge}>{t('web.moderator')}</span>
          )}
        </div>
        {!me.isModerator && (
          <div role="group" aria-label={t('web.cabinet')} className={s.switch}>
            {(['creator', 'advertiser'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cabinet === c}
                onClick={() => setCabinet(c)}
              >
                {t(`web.${c}`)}
              </button>
            ))}
          </div>
        )}
        <div className={s.user}>
          <span className={s.avatar} aria-hidden="true">
            {(me.firstName ?? 'F').slice(0, 1).toUpperCase()}
          </span>
          <span className={s.who}>
            <span className={s.name}>{me.firstName ?? 'Fixum'}</span>
            <span className={s.role}>{role}</span>
          </span>
          <button type="button" className={s.logout} onClick={onLogout}>
            {t('web.logout')}
          </button>
        </div>
      </aside>
      <main className={s.main}>
        <h1>{t('web.soonTitle')}</h1>
        <p>{t('web.soonText')}</p>
      </main>
    </div>
  );
}
