import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { categoryLabel, PLATFORM_NAMES, type OrderSummary } from '../api';
import {
  budgetViews,
  formatDate,
  formatMoney,
  formatViews,
  timeAgo,
} from '../format';
import s from './OrderCard.module.css';
import { PlatformIcon } from './PlatformIcon';

/**
 * Карточка заказа в каталоге — та же, что в мини-аппе (webapp/src/components/OrderCard.tsx). preview — та же карточка, но не ссылка: предпросмотр в форме заказа,
 * заказа ещё нет. Текст от пользователей React экранирует сам — не использовать dangerouslySetInnerHTML.
 */
export function OrderCard({
  order,
  preview,
}: {
  order: OrderSummary;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <div className={s.top}>
        <div className={s.tags}>
          {order.platforms.map((p) => (
            <span key={p} className={`${s.tag} ${s.platform}`}>
              <PlatformIcon platform={p} size={18} round />
              {PLATFORM_NAMES[p]}
            </span>
          ))}
          {!order.platforms.length && (
            <span className={s.tag}>{t('orderCard.anyPlatform')}</span>
          )}
          <span className={s.tag}>{categoryLabel(order.category)}</span>
          {order.linkInBio && (
            <span className={`${s.tag} ${s.bio}`}>
              {t('orderCard.linkInBio')}
            </span>
          )}
        </div>
        {order.deadline ? (
          <span className={s.deadline}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {t('orderCard.until', { date: formatDate(order.deadline) })}
          </span>
        ) : (
          <span className={s.ago}>{timeAgo(order.createdAt)}</span>
        )}
      </div>

      <div className={s.text}>
        <div className={s.title}>{order.title}</div>
        <div className={s.desc}>{order.description}</div>
      </div>

      {/* лайм — деньги: ставка плашкой с тёмным текстом читается в обеих темах */}
      {order.cpm !== null ? (
        <div className={s.price}>
          <span className={s.cpm}>{formatMoney(order.cpm)}</span>
          <span className={s.per}>{t('money.perThousand')}</span>
        </div>
      ) : (
        <span className={s.per}>{t('money.cpmPending')}</span>
      )}

      <div className={s.meta}>
        {/* Предпросмотр рекламодателю (ставки ещё нет) — без остатка: по нему видна комиссия. */}
        {order.fundBusy ? (
          <span className={`${s.free} ${s.busy}`}>
            {t('orderCard.fundBusy')}
          </span>
        ) : (
          (!preview || order.cpm !== null) && (
            <span className={order.budgetLow ? `${s.free} ${s.low}` : s.free}>
              {order.freeUnder
                ? t('orderCard.leftUnder', {
                    amount: formatMoney(order.freeUnder),
                  })
                : t('orderCard.left', { amount: formatMoney(order.free) }) +
                  (order.cpm
                    ? ` · ${t('orderCard.approxViews', { views: formatViews(budgetViews(order.free, order.cpm)) })}`
                    : '')}
              {order.budgetLow && t('orderCard.hurry')}
            </span>
          )
        )}
        <span>
          {t('orderCard.minViews', { views: formatViews(order.minViews) })}
        </span>
      </div>
    </>
  );
  return preview ? (
    <div className={s.card}>{body}</div>
  ) : (
    <Link to={`/orders/${order.id}`} className={s.card}>
      {body}
    </Link>
  );
}
