import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  closeOrder,
  deleteOrder,
  errorText,
  extendOrder,
  fetchMyOrders,
  type MyOrder,
} from '../api';
import { formatDate, formatMoney, formatViews } from '../format';
import s from '../ui.module.css';

/** Цвет метки статуса; текст — в словаре (myOrderCard.status). */
const TONE: Record<MyOrder['status'], 'warn' | 'success' | 'danger' | 'muted'> =
  {
    PENDING_MODERATION: 'warn',
    OPEN: 'success',
    REJECTED: 'danger',
    CLOSED: 'muted',
    EXPIRED: 'muted',
    EDIT_REJECTED: 'danger',
  };

/** На сколько дней продлить — как варианты срока в форме заказа. */
const EXTEND_DAYS = [3, 7, 14, 30];

/** Мои заказы — как в мини-аппе (webapp/src/views/MyOrdersView.tsx и MyOrderCard), карточками в сетку. */
export function MyOrders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<MyOrder[]>();
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetchMyOrders().then(setOrders, () => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div className={s.page}>
      <div className={s.cardHead}>
        <h1>{t('myOrders.title')}</h1>
        <Link
          to="/my-orders/new"
          className={`${s.btn} ${s.primary} ${s.linkBtn}`}
        >
          + {t('myOrders.place')}
        </Link>
      </div>

      {error ? (
        <div className={s.buttons}>
          <p className={s.hint}>{t('myOrders.loadError')}</p>
          <button type="button" className={s.btn} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      ) : !orders ? (
        <p className={s.hint}>{t('common.loading')}</p>
      ) : (
        orders.length === 0 && (
          <div className={s.card}>
            <h2>{t('myOrders.emptyTitle')}</h2>
            <p className={s.hint}>{t('myOrders.empty')}</p>
          </div>
        )
      )}

      <div className={s.cards}>
        {orders?.map((o) => (
          <OrderItem key={o.id} order={o} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

/** Карточка своего заказа. onChanged — заказ закрыт, продлён или удалён: перечитать список. */
function OrderItem({
  order,
  onChanged,
}: {
  order: MyOrder;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [extending, setExtending] = useState(false);

  /** Продлить можно открытый заказ со сроком и заказ, закрытый по сроку. */
  const canExtend =
    order.status === 'EXPIRED' || (order.status === 'OPEN' && !!order.deadline);

  async function run(question: string | null, action: () => Promise<unknown>) {
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorText(err, t('myOrderCard.error')));
    } finally {
      setBusy(false);
    }
  }

  // замороженный закрывается иначе: правка отменяется, слоты «в работе» сгорают
  const close = () =>
    run(
      t(
        order.frozen
          ? 'myOrderCard.closeFrozenConfirm'
          : 'myOrderCard.closeConfirm',
      ),
      () => closeOrder(order.id),
    );
  const extend = (days: number) =>
    run(null, async () => {
      await extendOrder(order.id, days);
      setExtending(false);
    });
  const remove = () =>
    run(t('myOrderCard.deleteConfirm'), () => deleteOrder(order.id));

  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <h2>{order.title}</h2>
        <span className={`${s.badge} ${s[TONE[order.status]]}`}>
          {t(`myOrderCard.status.${order.status}`)}
        </span>
      </div>
      <p className={s.hint}>
        {t('myOrderCard.budget', { amount: formatMoney(order.budget) })}
        {order.deadline &&
          t('myOrderCard.until', { date: formatDate(order.deadline) })}
        {order.status === 'PENDING_MODERATION' && t('myOrderCard.pending')}
      </p>

      {(order.approved > 0 || order.usedPercent > 0) && (
        <>
          <div className={s.bar} aria-hidden="true">
            <span style={{ width: `${order.usedPercent}%` }} />
          </div>
          <div className={s.kpis}>
            <span>
              <b>{formatViews(order.views)}</b>
              {t('myOrderCard.kpiViews')}
            </span>
            <span>
              <b>{order.approved}</b>
              {t('myOrderCard.kpiVideos')}
            </span>
            <span>
              <b>{order.usedPercent}%</b>
              {t('myOrderCard.kpiBudget')}
            </span>
          </div>
        </>
      )}

      {order.approved > 0 ? (
        <Link to={`/my-orders/${order.id}/report`} className={s.linkRow}>
          <span>
            <strong>
              {t('myOrderCard.report', { count: order.approved })}
            </strong>
            <small>
              {order.toRate > 0
                ? t('myOrderCard.toRate', { count: order.toRate })
                : t('myOrderCard.totalSubmissions', {
                    count: order.submissionsCount,
                  })}
            </small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        order.submissionsCount > 0 && (
          <p className={s.hint}>
            {t('myOrderCard.submissions', { count: order.submissionsCount })}
          </p>
        )
      )}

      {(order.status === 'REJECTED' || order.status === 'EDIT_REJECTED') &&
        order.rejectReason && (
          <p className={s.dangerNote}>
            {t('myOrderCard.moderator', { reason: order.rejectReason })}
          </p>
        )}
      {order.frozen && <p className={s.hint}>{t('myOrderCard.frozen')}</p>}
      {order.fundBusy && <p className={s.hint}>{t('myOrderCard.fundBusy')}</p>}
      {order.status === 'EXPIRED' && (
        <p className={s.hint}>{t('myOrderCard.expired')}</p>
      )}

      {extending && (
        <div className={s.chips}>
          {EXTEND_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={busy}
              onClick={() => extend(d)}
            >
              {t('myOrderCard.extendBy', { count: d })}
            </button>
          ))}
        </div>
      )}
      <div className={s.buttons}>
        {order.status === 'REJECTED' && (
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            onClick={() => void navigate(`/my-orders/new?from=${order.id}`)}
          >
            {t('myOrderCard.fix')}
          </button>
        )}
        {(order.status === 'PENDING_MODERATION' ||
          order.status === 'OPEN' ||
          order.status === 'EDIT_REJECTED') && (
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={() => void navigate(`/my-orders/${order.id}/edit`)}
          >
            {t('myOrderCard.edit')}
          </button>
        )}
        {canExtend && (
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={() => setExtending(!extending)}
          >
            {extending ? t('common.cancel') : t('myOrderCard.extend')}
          </button>
        )}
        {(order.status === 'OPEN' || order.frozen) && (
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={close}
          >
            {t('myOrderCard.close')}
          </button>
        )}
        {/* та же форма, что «Исправить»: поля подставятся из этого заказа */}
        {order.status !== 'REJECTED' &&
          order.status !== 'PENDING_MODERATION' &&
          order.status !== 'EDIT_REJECTED' && (
            <button
              type="button"
              className={s.btn}
              disabled={busy}
              onClick={() => void navigate(`/my-orders/new?from=${order.id}`)}
            >
              {t('myOrderCard.similar')}
            </button>
          )}
        {order.deletable && (
          <button
            type="button"
            className={`${s.btn} ${s.reject}`}
            disabled={busy}
            onClick={remove}
          >
            {t('myOrderCard.delete')}
          </button>
        )}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
