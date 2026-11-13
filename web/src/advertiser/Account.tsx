import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserStats,
  advertiserTodo,
  type CreatorProfile,
  fetchAdvertiserStats,
  fetchMyOrders,
  fetchMyProfile,
  type MyOrder,
} from '../api';
import { Avatar } from '../components/Avatar';
import { LanguagePicker } from '../components/LanguagePicker';
import { formatDate, formatMoney, formatViews } from '../format';
import { useSession } from '../session';
import s from '../ui.module.css';

/**
 * Профиль заказчика: кто он, сводка со ссылками в «Статистику» и «Мои заказы», что ждёт его действий,
 * язык, поддержка и политика — как в мини-аппе (webapp/src/views/AccountView.tsx).
 */
export function Account() {
  const { t } = useTranslation();
  const { me } = useSession();
  const [profile, setProfile] = useState<CreatorProfile>();
  const [orders, setOrders] = useState<MyOrder[]>();
  const [stats, setStats] = useState<AdvertiserStats>();
  // всё второстепенное: не загрузилось — просто не показываем
  useEffect(() => {
    fetchMyProfile().then(setProfile, () => {});
    fetchMyOrders().then(setOrders, () => {});
    fetchAdvertiserStats(undefined).then(setStats, () => {});
  }, []);

  const name = me.firstName ?? t('tabs.profile');
  const approved = orders?.reduce((n, o) => n + o.approved, 0) ?? 0;
  const todo = orders ? advertiserTodo(orders) : [];

  return (
    <div className={`${s.page} ${s.narrow}`}>
      <header className={s.profileHead}>
        {profile && <Avatar userId={profile.id} name={name} size={56} />}
        <div>
          <h1>{name}</h1>
          <p className={s.hint}>
            {me.advertiser === 'closed'
              ? t('account.closed')
              : me.advertiserSince
                ? t('account.since', { date: formatDate(me.advertiserSince) })
                : t('account.subtitle')}
          </p>
        </div>
      </header>

      {!!orders?.length && (
        <div className={s.tiles}>
          <Link to="/stats" className={`${s.tile} ${s.tileLink}`}>
            <strong>
              {formatViews(orders.reduce((n, o) => n + o.views, 0))}
            </strong>
            <span>{t('account.views')}</span>
          </Link>
          {stats && (
            <>
              <Link to="/stats" className={`${s.tile} ${s.tileLink}`}>
                <strong>{formatMoney(stats.summary.spent)}</strong>
                <span>{t('account.spent')}</span>
              </Link>
              <Link to="/stats" className={`${s.tile} ${s.tileLink}`}>
                <strong>
                  {stats.summary.cpm === null
                    ? '—'
                    : formatMoney(stats.summary.cpm)}
                </strong>
                <span>{t('account.perThousand')}</span>
              </Link>
            </>
          )}
          <Link to="/my-orders" className={`${s.tile} ${s.tileLink}`}>
            <strong>{orders.length}</strong>
            <span>{t('account.orders', { count: orders.length })}</span>
          </Link>
          <Link to="/my-orders" className={`${s.tile} ${s.tileLink}`}>
            <strong>{approved}</strong>
            <span>{t('account.approved', { count: approved })}</span>
          </Link>
        </div>
      )}

      {todo.length > 0 && (
        <section className={s.card}>
          <h2>{t('account.todoTitle')}</h2>
          {todo.map((item) => (
            <Link
              key={`${item.kind}-${item.orderId}`}
              // оценка — в отчёте заказа, остальное — в списке заказов
              to={
                item.kind === 'rate'
                  ? `/my-orders/${item.orderId}/report`
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

      <LanguagePicker />

      <p className={`${s.hint} ${s.small}`}>{t('account.namesHint')}</p>
      {/* поддержка, политика и соглашение — через точку, что есть */}
      <p className={`${s.hint} ${s.small}`}>
        {[
          me.supportUrl && (
            <Link key="support" to="/support">
              {t('common.support')}
            </Link>
          ),
          // страницы сайта (собираются вместе с лендингом), а не мини-аппа
          <a
            key="privacy"
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('catalog.privacy')}
          </a>,
          <a
            key="terms"
            href="/terms.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('catalog.terms')}
          </a>,
        ]
          .filter(Boolean)
          .flatMap((link, i) => (i ? [' · ', link] : [link]))}
      </p>
    </div>
  );
}
