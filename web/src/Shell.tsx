import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet } from 'react-router';
import { Logo } from './Login';
import { useSession } from './session';
import s from './Shell.module.css';

type Cabinet = 'creator' | 'advertiser';

const MOD_NAV = [
  { to: '/mod', label: 'Очередь', end: true },
  { to: '/mod/orders', label: 'Заказы' },
  { to: '/mod/users', label: 'Люди' },
  { to: '/mod/payouts', label: 'Выплаты' },
  { to: '/mod/stats', label: 'Статистика' },
  { to: '/mod/what-works', label: 'Что работает' },
  { to: '/mod/me', label: 'Я' },
];

/** Каркас после входа: боковая панель (разделы, кто вошёл, выход) и экран раздела справа. */
export function Shell() {
  const { t } = useTranslation();
  const { me, logout } = useSession();
  const [cabinet, setCabinet] = useState<Cabinet>(me.cabinet ?? 'creator');
  const role = me.isModerator ? t('web.moderator') : t(`web.${cabinet}`);

  return (
    <div className={s.layout}>
      <aside className={s.nav}>
        <div className={s.head}>
          <Logo />
        </div>
        {me.isModerator ? (
          <nav aria-label="Разделы" className={s.links}>
            {MOD_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          // ponytail: кабинет пока только переключает подпись — разделы заказчика и креатора будут в 3c/3d
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
          <button type="button" className={s.logout} onClick={logout}>
            {t('web.logout')}
          </button>
        </div>
      </aside>
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

/** Главная: модератор — сразу в очередь; остальным разделы появятся следующими шагами. */
export function Home() {
  const { t } = useTranslation();
  if (useSession().me.isModerator) return <Navigate to="/mod" replace />;
  return (
    <div className={s.soon}>
      <h1>{t('web.soonTitle')}</h1>
      <p>{t('web.soonText')}</p>
    </div>
  );
}
