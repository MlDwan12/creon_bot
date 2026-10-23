import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type CreatorProfile,
  fetchMyOrders,
  fetchMyProfile,
  type MyOrder,
} from '../api';
import AppSettings from '../components/AppSettings';
import SupportLink from '../components/SupportLink';
import UserAvatar from '../components/UserAvatar';
import { formatViews } from '../format';
import s from './AccountView.module.css';

/**
 * Профиль в кабинете заказчика: сводка по его рекламе и настройки. Кошелёк, соцсети и отзывы —
 * креаторские, они в /profile.
 */
export default function AccountView() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<CreatorProfile>();
  const [orders, setOrders] = useState<MyOrder[]>();
  // всё второстепенное: не загрузилось — просто не показываем
  useEffect(() => {
    fetchMyProfile().then(setProfile, () => {});
    fetchMyOrders().then(setOrders, () => {});
  }, []);

  const summary = orders?.length
    ? {
        views: orders.reduce((sum, o) => sum + o.views, 0),
        orders: orders.length,
        approved: orders.reduce((sum, o) => sum + o.approved, 0),
      }
    : undefined;

  return (
    <main className={s.page}>
      {profile && (
        <header className={s.head}>
          <UserAvatar userId={profile.id} name={profile.name} size={64} />
          <div className={s.who}>
            <h1>{profile.name}</h1>
            <span className={s.hint}>{t('account.subtitle')}</span>
          </div>
        </header>
      )}

      {summary && (
        <Link to="/my-orders" className={s.summary}>
          <span className={`money ${s.views}`}>
            {formatViews(summary.views)}
          </span>
          <span className={s.hint}>{t('account.views')}</span>
          <span className={s.kpis}>
            <span>
              <b>{summary.orders}</b>
              {t('account.orders', { count: summary.orders })}
            </span>
            <span>
              <b>{summary.approved}</b>
              {t('account.approved', { count: summary.approved })}
            </span>
          </span>
        </Link>
      )}

      <AppSettings />

      <div className={s.links}>
        <SupportLink />
        <Link to="/privacy" className="quiet-link">
          {t('catalog.privacy')}
        </Link>
      </div>
    </main>
  );
}
