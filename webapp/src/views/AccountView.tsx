import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserStats,
  advertiserTodo,
  type CreatorProfile,
  fetchAdvertiserStats,
  fetchMe,
  fetchMyOrders,
  fetchMyProfile,
  type Me,
  type MyOrder,
} from '../api';
import AppSettings from '../components/AppSettings';
import SupportLink from '../components/SupportLink';
import UserAvatar from '../components/UserAvatar';
import { formatDate, formatMoney, formatViews } from '../format';
import s from './AccountView.module.css';

/**
 * Профиль в кабинете заказчика: сводка по его рекламе и настройки. Кошелёк, соцсети и отзывы —
 * креаторские, они в /profile.
 */
export default function AccountView() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<CreatorProfile>();
  const [orders, setOrders] = useState<MyOrder[]>();
  const [stats, setStats] = useState<AdvertiserStats>();
  const [me, setMe] = useState<Me>();
  // всё второстепенное: не загрузилось — просто не показываем
  useEffect(() => {
    fetchMyProfile().then(setProfile, () => {});
    fetchMyOrders().then(setOrders, () => {});
    fetchAdvertiserStats(undefined).then(setStats, () => {});
    fetchMe().then(setMe, () => {});
  }, []);
  const todo = orders ? advertiserTodo(orders) : [];

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
            <span className={s.hint}>
              {me?.advertiser === 'closed'
                ? t('account.closed')
                : me?.advertiserSince
                  ? t('account.since', { date: formatDate(me.advertiserSince) })
                  : t('account.subtitle')}
            </span>
          </div>
        </header>
      )}

      {summary && (
        <>
          {/* просмотры и деньги — в «Статистику», заказы и ролики — в «Мои заказы» */}
          <Link to="/stats" className={s.summary}>
            <span className={`money ${s.views}`}>
              {formatViews(summary.views)}
            </span>
            <span className={s.hint}>{t('account.views')}</span>
            {stats && (
              <span className={s.kpis}>
                <span>
                  <b>{formatMoney(stats.summary.spent)}</b>
                  {t('account.spent')}
                </span>
                <span>
                  <b>
                    {stats.summary.cpm === null
                      ? '—'
                      : formatMoney(stats.summary.cpm)}
                  </b>
                  {t('account.perThousand')}
                </span>
              </span>
            )}
          </Link>
          <Link to="/my-orders" className={s.summary}>
            <span className={`${s.kpis} ${s.flat}`}>
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
        </>
      )}

      {todo.length > 0 && (
        <section className={s.todo}>
          <h2 className="section-title">{t('account.todoTitle')}</h2>
          {todo.map((item) => (
            <Link
              key={`${item.kind}-${item.orderId}`}
              // оценка — в отчёте заказа, остальное — в списке заказов
              to={
                item.kind === 'rate'
                  ? `/my-orders/${item.orderId}/review`
                  : '/my-orders'
              }
              className={s.todoRow}
            >
              <span>
                {t(`account.todo.${item.kind}`, {
                  title: item.title,
                  count: item.count,
                })}
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </section>
      )}

      <AppSettings />

      <span className={s.hint}>{t('account.namesHint')}</span>

      <div className={s.links}>
        <SupportLink />
        <Link to="/privacy" className="quiet-link">
          {t('catalog.privacy')}
        </Link>
      </div>
    </main>
  );
}
