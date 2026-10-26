import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  ApiError,
  closeOrder,
  deleteOrder,
  extendOrder,
  type MyOrder,
} from '../api';
import { formatDate, formatMoney, formatViews } from '../format';
import { confirmAction } from '../telegram';
import s from './MyOrderCard.module.css';

/** Цвет метки статуса; текст — в словаре (myOrderCard.status). */
const TONE: Record<MyOrder['status'], string> = {
  PENDING_MODERATION: 'warn',
  OPEN: 'success',
  REJECTED: 'danger',
  CLOSED: 'muted',
  EXPIRED: 'muted',
  EDIT_REJECTED: 'danger',
};

/** На сколько дней продлить — как варианты срока в форме заказа. */
const EXTEND_DAYS = [3, 7, 14, 30];

/** Карточка своего заказа у заказчика. onChanged — список надо перезагрузить (MyOrdersView). */
export default function MyOrderCard({
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
    if (question && !(await confirmAction(question))) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('myOrderCard.error'),
      );
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
      <div className={s.top}>
        <div className={s.title}>{order.title}</div>
        <span className={`${s.badge} ${s[TONE[order.status]]}`}>
          {t(`myOrderCard.status.${order.status}`)}
        </span>
      </div>
      <div className={s.hint}>
        {t('myOrderCard.budget', { amount: formatMoney(order.budget) })}
        {order.deadline &&
          t('myOrderCard.until', { date: formatDate(order.deadline) })}
        {order.status === 'PENDING_MODERATION' && t('myOrderCard.pending')}
      </div>

      {(order.approved > 0 || order.usedPercent > 0) && (
        <div className={s.usage}>
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
        </div>
      )}

      {order.approved > 0 ? (
        <Link to={`/my-orders/${order.id}/review`} className={s.pending}>
          <span>
            <strong>
              {t('myOrderCard.report', { count: order.approved })}
            </strong>
            {order.toRate > 0 ? (
              <small>{t('myOrderCard.toRate', { count: order.toRate })}</small>
            ) : (
              <small>
                {t('myOrderCard.totalSubmissions', {
                  count: order.submissionsCount,
                })}
              </small>
            )}
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        order.submissionsCount > 0 && (
          <div className={s.hint}>
            {t('myOrderCard.submissions', { count: order.submissionsCount })}
          </div>
        )
      )}

      {order.status === 'REJECTED' && (
        <>
          {order.rejectReason && (
            <p className={s.reason}>
              {t('myOrderCard.moderator', { reason: order.rejectReason })}
            </p>
          )}
          <Link to={`/my-orders/new?from=${order.id}`} className={s.action}>
            {t('myOrderCard.fix')}
          </Link>
        </>
      )}
      {order.status === 'EDIT_REJECTED' && order.rejectReason && (
        <p className={s.reason}>
          {t('myOrderCard.moderator', { reason: order.rejectReason })}
        </p>
      )}
      {order.frozen && <p className={s.hint}>{t('myOrderCard.frozen')}</p>}
      {order.fundBusy && (
        <p className={s.hint}>{t('myOrderCard.fundBusy')}</p>
      )}

      {order.status === 'EXPIRED' && (
        <p className={s.hint}>{t('myOrderCard.expired')}</p>
      )}

      {extending && (
        <div className={s.buttons}>
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
        {(order.status === 'PENDING_MODERATION' ||
          order.status === 'OPEN' ||
          order.status === 'EDIT_REJECTED') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void navigate(`/my-orders/${order.id}/edit`)}
          >
            {t('myOrderCard.edit')}
          </button>
        )}
        {canExtend && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setExtending(!extending)}
          >
            {extending ? t('common.cancel') : t('myOrderCard.extend')}
          </button>
        )}
        {(order.status === 'OPEN' || order.frozen) && (
          <button type="button" disabled={busy} onClick={close}>
            {t('myOrderCard.close')}
          </button>
        )}
        {/* та же форма, что «Исправить и отправить снова»: поля подставятся из этого заказа */}
        {order.status !== 'REJECTED' &&
          order.status !== 'PENDING_MODERATION' &&
          order.status !== 'EDIT_REJECTED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void navigate(`/my-orders/new?from=${order.id}`)}
            >
              {t('myOrderCard.similar')}
            </button>
          )}
        {order.deletable && (
          <button
            type="button"
            className={s.danger}
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
