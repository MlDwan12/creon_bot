import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router';
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

/** Раздел меню для открытого адреса: точное совпадение или самый длинный префикс («/» — только сам). */
function currentItem(items: { to: string; label: string }[], path: string) {
  return items
    .filter(
      (i) => path === i.to || (i.to !== '/' && path.startsWith(`${i.to}/`)),
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
}

/**
 * Каркас после входа: боковая панель (кабинет, разделы, кто вошёл, выход) и экран раздела справа.
 * На телефоне панель — меню под кнопкой в тонкой полосе сверху: иначе она занимала бы треть экрана.
 */
export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { me, setMe, logout } = useSession();
  const cabinet: Cabinet = me.cabinet ?? 'creator';
  const role = me.isModerator ? t('web.moderator') : t(`web.${cabinet}`);
  const [menuOpen, setMenuOpen] = useState(false);
  // перешли в другой раздел — меню закрываем
  useEffect(() => setMenuOpen(false), [pathname]);
  // открыли меню — фокус на первый пункт: с клавиатуры и в читалке экрана сразу внутри меню
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuOpen)
      menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [menuOpen]);
  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  const items = me.isModerator
    ? MOD_NAV
    : (cabinet === 'advertiser' ? ADVERTISER_NAV : CREATOR_NAV).map((i) => ({
        ...i,
        label: t(i.label),
      }));
  const section =
    pathname === '/support'
      ? t('common.support')
      : (currentItem(items, pathname)?.label ?? 'Fixum');

  function pickCabinet(c: Cabinet) {
    setMe({ ...me, cabinet: c });
    // не сохранился — не беда: следующий вход откроет прошлый кабинет
    updateCabinet(c).catch(() => {});
    void navigate(CABINET_HOME[c]);
  }

  return (
    <div className={s.layout}>
      <header className={s.bar}>
        <Link to="/" className={s.barLogo} aria-label={t('web.home')}>
          <span aria-hidden="true">F</span>
        </Link>
        <span className={s.barTitle}>{section}</span>
        <button
          type="button"
          ref={menuButtonRef}
          className={s.menuButton}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path
              d={menuOpen ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'}
            />
          </svg>
          {menuOpen ? t('web.menuClose') : t('web.menu')}
        </button>
      </header>
      {menuOpen && (
        <div
          className={s.scrim}
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="site-menu"
        ref={menuRef}
        className={`${s.nav} ${menuOpen ? s.navOpen : ''}`}
        onKeyDown={(e) => menuOpen && e.key === 'Escape' && closeMenu()}
        // Tab увёл фокус из меню на страницу под затемнением — меню закрываем
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null;
          if (
            menuOpen &&
            to &&
            !menuRef.current?.contains(to) &&
            to !== menuButtonRef.current
          )
            setMenuOpen(false);
        }}
        // нажали раздел, где уже находимся, — адрес тот же, закрываем сами
        onClick={(e) =>
          (e.target as HTMLElement).closest('a') && setMenuOpen(false)
        }
      >
        <div className={s.head}>
          <Link to="/" className={s.logoLink} aria-label={t('web.home')}>
            <Logo />
          </Link>
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
