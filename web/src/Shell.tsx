import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { updateCabinet } from './api';
import { Catalog } from './creator/Catalog';
import { Logo } from './Login';
import { useSession } from './session';
import s from './Shell.module.css';

type Cabinet = 'creator' | 'advertiser';

// окно модератора — только по-русски, как в мини-аппе
const MOD_NAV = [
  { to: '/mod', label: 'Очередь' },
  { to: '/mod/orders', label: 'Заказы' },
  { to: '/mod/users', label: 'Люди' },
  { to: '/mod/payouts', label: 'Выплаты' },
  { to: '/mod/stats', label: 'Статистика' },
  { to: '/mod/what-works', label: 'Что работает' },
  { to: '/mod/me', label: 'Я' },
];
const ADVERTISER_NAV = [
  { to: '/my-orders', label: 'tabs.myOrders' },
  { to: '/my-orders/new', label: 'createOrder.titleNew' },
  { to: '/help', label: 'tabs.help' },
  { to: '/account', label: 'tabs.profile' },
];
const CREATOR_NAV = [
  { to: '/', label: 'tabs.orders' },
  { to: '/submissions', label: 'tabs.submissions' },
  { to: '/balance', label: 'balance.title' },
  { to: '/learn', label: 'tabs.learn' },
  { to: '/profile', label: 'tabs.profile' },
];
/** Куда вести после выбора кабинета. */
const CABINET_HOME: Record<Cabinet, string> = {
  advertiser: '/my-orders',
  creator: '/',
};

/** Каркас после входа: боковая панель (кабинет, разделы, кто вошёл, выход) и экран раздела справа. */
export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { me, setMe, logout } = useSession();
  const cabinet: Cabinet = me.cabinet ?? 'creator';
  const role = me.isModerator ? t('web.moderator') : t(`web.${cabinet}`);

  function pickCabinet(c: Cabinet) {
    setMe({ ...me, cabinet: c });
    // не сохранился — не беда: следующий вход откроет прошлый кабинет
    updateCabinet(c).catch(() => {});
    void navigate(CABINET_HOME[c]);
  }

  return (
    <div className={s.layout}>
      <aside className={s.nav}>
        <div className={s.head}>
          <Logo />
        </div>
        {me.isModerator ? (
          <nav aria-label={t('tabs.aria')} className={s.links}>
            {MOD_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <>
            <div
              role="group"
              aria-label={t('web.cabinet')}
              className={s.switch}
            >
              {(['creator', 'advertiser'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={cabinet === c}
                  onClick={() => pickCabinet(c)}
                >
                  {t(`web.${c}`)}
                </button>
              ))}
            </div>
            <nav aria-label={t('tabs.aria')} className={s.links}>
              {(cabinet === 'advertiser' ? ADVERTISER_NAV : CREATOR_NAV).map(
                (item) => (
                  <NavLink key={item.to} to={item.to} end>
                    {t(item.label)}
                  </NavLink>
                ),
              )}
            </nav>
          </>
        )}
        <div className={s.bottom}>
          {me.supportUrl && !me.isModerator && (
            <NavLink to="/support" className={s.support}>
              {t('common.support')}
            </NavLink>
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
        </div>
      </aside>
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

/** Главная: модератор — в очередь, заказчик — к своим заказам, креатор — каталог. */
export function Home() {
  const { me } = useSession();
  if (me.isModerator) return <Navigate to="/mod" replace />;
  if (me.cabinet === 'advertiser') return <Navigate to="/my-orders" replace />;
  return <Catalog />;
}
