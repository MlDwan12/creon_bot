import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { fetchModPayouts, fetchModQueue, fetchModReports } from '../api';
import { role as roleStore } from '../role';
import { useStore } from '../store';
import s from './TabBar.module.css';

/** NavLink сам ставит класс active на вкладку текущего экрана. */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${s.tab} active` : s.tab;

export default function TabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const role = useStore(roleStore);
  /** У модератора свои вкладки — его окно отдельное; у креатора и заказчика — свои (role.ts). */
  const moderator = pathname.startsWith('/mod');

  // Модератору — счётчики на вкладках: сколько ждёт в очереди и сколько заявок на вывод.
  // Обновляем при переходах, но не чаще раза в 15 секунд.
  const [modCounts, setModCounts] = useState<{
    queue: number;
    payouts: number;
  }>();
  const countedAt = useRef(0);
  useEffect(() => {
    if (!moderator || Date.now() - countedAt.current < 15_000) return;
    countedAt.current = Date.now();
    Promise.all([fetchModQueue(), fetchModReports(), fetchModPayouts()])
      .then(([q, reports, payouts]) =>
        setModCounts({
          queue:
            q.orders.length +
            q.videos.length +
            q.holds.length +
            q.reviews.length +
            reports.length,
          payouts: payouts.length,
        }),
      )
      .catch(() => {}); // без счётчиков вкладки работают как обычно
  }, [pathname, moderator]);

  return (
    // Подложка до края экрана: под плавающей плашкой не просвечивает прокрученный контент.
    <div className={`tabbar ${s.tabbar}`}>
      <nav className={s.bar} aria-label={t('tabs.aria')}>
        {moderator ? (
          <>
            <NavLink to="/mod" end className={tabClass}>
              {!!modCounts?.queue && (
                <span className={s.badge}>{modCounts.queue}</span>
              )}
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
                <path d="M4 13h4.5l1 2.5h5l1-2.5H20" />
              </svg>
              {t('tabs.modQueue')}
            </NavLink>
            <NavLink to="/mod/payouts" className={tabClass}>
              {!!modCounts?.payouts && (
                <span className={s.badge}>{modCounts.payouts}</span>
              )}
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="6" width="18" height="13" rx="2.5" />
                <path d="M3 10.5h18M7 15h3" />
              </svg>
              {t('tabs.modPayouts')}
            </NavLink>
            <NavLink to="/mod/orders" end className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
              {t('tabs.modOrders')}
            </NavLink>
            <NavLink to="/mod/stats" end className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 20V11M10 20V5M16 20v-7M21 20H3" />
              </svg>
              {t('tabs.modStats')}
            </NavLink>
            <NavLink to="/mod/me" end className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
              </svg>
              {t('tabs.modMe')}
            </NavLink>
          </>
        ) : role === 'advertiser' ? (
          <>
            <NavLink to="/my-orders" className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="7" width="18" height="13" rx="2" />
                <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
              </svg>
              {t('tabs.myOrders')}
            </NavLink>
            <NavLink to="/help" className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01" />
              </svg>
              {t('tabs.help')}
            </NavLink>
            <NavLink to="/account" className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
              </svg>
              {t('tabs.profile')}
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="4" width="7" height="7" rx="1.5" />
                <rect x="13" y="4" width="7" height="7" rx="1.5" />
                <rect x="4" y="13" width="7" height="7" rx="1.5" />
                <rect x="13" y="13" width="7" height="7" rx="1.5" />
              </svg>
              {t('tabs.orders')}
            </NavLink>
            <NavLink to="/submissions" className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M10 9.5v5l4.5-2.5z" />
              </svg>
              {t('tabs.submissions')}
            </NavLink>
            <NavLink to="/learn" className={tabClass}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
              </svg>
              {t('tabs.learn')}
            </NavLink>
            {/* баланс открывается из профиля — вкладка подсвечена и там */}
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                tabClass({ isActive: isActive || pathname === '/balance' })
              }
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
              </svg>
              {t('tabs.profile')}
            </NavLink>
          </>
        )}
      </nav>
    </div>
  );
}
