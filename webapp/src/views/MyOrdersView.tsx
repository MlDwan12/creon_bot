import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchMyOrders, type MyOrder } from '../api';
import EmptyState from '../components/EmptyState';
import LoadState from '../components/LoadState';
import MyOrderCard from '../components/MyOrderCard';
import s from './MyOrdersView.module.css';

export default function MyOrdersView() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrders(await fetchMyOrders());
    } catch {
      setError(t('myOrders.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  return (
    <main className={s.page}>
      <h1>{t('myOrders.title')}</h1>

      {loading || error ? (
        <LoadState error={error} onRetry={load} />
      ) : (
        orders.length === 0 && (
          <EmptyState
            title={t('myOrders.emptyTitle')}
            text={t('myOrders.empty')}
            icon={
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                <rect x="3" y="7" width="18" height="13" rx="2.5" />
                <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
              </svg>
            }
          >
            <Link to="/my-orders/new" className="main-button">
              {t('myOrders.place')}
            </Link>
          </EmptyState>
        )
      )}
      {/* главное действие кабинета — крупно и первым, пока заказы есть */}
      {orders.length > 0 && (
        <Link to="/my-orders/new" className={`main-button ${s.place}`}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('myOrders.place')}
        </Link>
      )}

      {/* onChanged — карточка сообщила, что заказ закрыт/удалён: перечитываем список. */}
      {orders.map((o) => (
        <MyOrderCard key={o.id} order={o} onChanged={load} />
      ))}
    </main>
  );
}
