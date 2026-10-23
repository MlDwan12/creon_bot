import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { fetchAllOrders, type ModOrderRow, type OrderStatus } from '../../api';
import { formatMoney, timeAgo } from '../../format';
import s from './ModAllOrdersView.module.css';

const STATUS: Record<ModOrderRow['status'], { label: string; tone: string }> = {
  PENDING_MODERATION: { label: 'На проверке', tone: 'warn' },
  OPEN: { label: 'Открыт', tone: 'success' },
  REJECTED: { label: 'Отклонён', tone: 'danger' },
  CLOSED: { label: 'Закрыт', tone: 'muted' },
  EXPIRED: { label: 'Срок вышел', tone: 'muted' },
  EDIT_REJECTED: { label: 'Правки отклонены', tone: 'danger' },
};

/** Фильтр по статусу: «Закрыты» — и закрытые вручную, и по сроку; «Отклонены» — и правки. */
const FILTERS: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Все', statuses: [] },
  { label: 'На проверке', statuses: ['PENDING_MODERATION'] },
  { label: 'Опубликованы', statuses: ['OPEN'] },
  { label: 'Закрыты', statuses: ['CLOSED', 'EXPIRED'] },
  { label: 'Отклонены', statuses: ['REJECTED', 'EDIT_REJECTED'] },
];

export default function ModAllOrdersView() {
  const [filter, setFilter] = useState(FILTERS[0]);
  const [orders, setOrders] = useState<ModOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Последняя загруженная страница; -1 — ещё ни одной. */
  const page = useRef(-1);
  const lastRequest = useRef(0);

  async function loadMore(reset = false) {
    // сменили фильтр, пока грузилась страница, — старый ответ не подмешиваем
    const requestId = ++lastRequest.current;
    if (reset) {
      page.current = -1;
      setOrders([]);
      setError('');
    }
    setLoading(true);
    try {
      const res = await fetchAllOrders(page.current + 1, filter.statuses);
      if (requestId !== lastRequest.current) return;
      setOrders((list) => [...list, ...res.items]);
      setTotal(res.total);
      page.current += 1;
    } catch {
      setError('Не удалось загрузить заказы');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void loadMore(true), [filter]); // грузим заново при смене фильтра

  return (
    <main className={s.page}>
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
      {error ? (
        <p className={s.hint}>{error}</p>
      ) : (
        !loading &&
        orders.length === 0 && (
          <p className={s.hint}>
            {filter.statuses.length
              ? 'С таким статусом заказов нет.'
              : 'Заказов пока нет.'}
          </p>
        )
      )}

      {orders.length > 0 && (
        <div className={s.list}>
          {orders.map((o) => (
            <Link key={o.id} to={`/mod/orders/${o.id}`} className={s.row}>
              <span className={s.main}>
                <span className={s.title}>{o.title}</span>
                <span className={s.sub}>
                  {o.advertiser} · бюджет {formatMoney(o.budget)} · откликов:{' '}
                  {o.submissionsCount} · {timeAgo(o.createdAt)}
                </span>
              </span>
              <span className={`${s.badge} ${s[STATUS[o.status].tone]}`}>
                {STATUS[o.status].label}
              </span>
            </Link>
          ))}
        </div>
      )}

      {orders.length < total && (
        <button
          type="button"
          className={s.more}
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </main>
  );
}
