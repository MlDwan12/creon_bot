import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { fetchAllOrders, type ModOrderRow, type OrderStatus } from '../api';
import { formatMoney, timeAgo } from '../format';
import s from '../ui.module.css';
import { ORDER_STATUS } from './OrderReview';
import { usePaged } from './usePaged';

/** Фильтр по статусу: «Закрыты» — и закрытые вручную, и по сроку; «Отклонены» — и правки. */
const FILTERS: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Все', statuses: [] },
  { label: 'На проверке', statuses: ['PENDING_MODERATION'] },
  { label: 'Опубликованы', statuses: ['OPEN'] },
  { label: 'Закрыты', statuses: ['CLOSED', 'EXPIRED'] },
  { label: 'Отклонены', statuses: ['REJECTED', 'EDIT_REJECTED'] },
];

/** Все заказы таблицей — как в мини-аппе (webapp/src/views/mod/ModAllOrdersView.tsx). */
export function AllOrders() {
  const [filter, setFilter] = useState(FILTERS[0]);
  const fetchPage = useCallback(
    (page: number) => fetchAllOrders(page, filter.statuses),
    [filter],
  );
  const list = usePaged<ModOrderRow>(fetchPage);

  return (
    <div className={s.page}>
      <h1>Все заказы</h1>
      <div className={s.chips} role="radiogroup" aria-label="Статус">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <p className={s.hint}>Не удалось загрузить заказы</p>
      ) : (
        !list.loading &&
        list.items.length === 0 && (
          <p className={s.hint}>
            {filter.statuses.length
              ? 'С таким статусом заказов нет.'
              : 'Заказов пока нет.'}
          </p>
        )
      )}

      {list.items.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Рекламодатель</th>
                <th className={s.num}>Бюджет</th>
                <th className={s.num}>Откликов</th>
                <th>Создан</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/mod/orders/${o.id}`}>{o.title}</Link>
                    <small>#{o.id}</small>
                  </td>
                  <td data-label="Рекламодатель">{o.advertiser}</td>
                  <td data-label="Бюджет" className={s.num}>
                    {formatMoney(o.budget)}
                  </td>
                  <td data-label="Откликов" className={s.num}>
                    {o.submissionsCount}
                  </td>
                  <td data-label="Создан">{timeAgo(o.createdAt)}</td>
                  <td data-label="Статус">
                    <span
                      className={`${s.badge} ${s[ORDER_STATUS[o.status].tone]}`}
                    >
                      {ORDER_STATUS[o.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.items.length < list.total && (
        <button
          type="button"
          className={`${s.btn} ${s.more}`}
          disabled={list.loading}
          onClick={list.loadMore}
        >
          {list.loading ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
