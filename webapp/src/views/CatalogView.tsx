import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  categoryLabel,
  fetchMyProfile,
  fetchOpenOrders,
  ORDER_CATEGORIES,
  type OrderCategory,
  type OrderSummary,
  PLATFORM_NAMES,
  updateNotifications,
  VIDEO_PLATFORMS,
  type VideoPlatform,
} from '../api';
import EmptyState from '../components/EmptyState';
import LoadState from '../components/LoadState';
import OrderCard from '../components/OrderCard';
import PlatformIcon from '../components/PlatformIcon';
import SupportLink from '../components/SupportLink';
import s from './CatalogView.module.css';

// Площадку запоминаем: креатор обычно снимает для одной-двух, не выбирать каждый раз.
const PLATFORM_KEY = 'catalog.platform';
function readPlatform() {
  try {
    const saved = localStorage.getItem(PLATFORM_KEY);
    return VIDEO_PLATFORMS.find((p) => p === saved);
  } catch {
    return undefined;
  }
}

export default function CatalogView() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<OrderCategory>();
  const [platform, setPlatform] = useState<VideoPlatform | undefined>(
    readPlatform,
  );
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lastRequest = useRef(0);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  /** reset — новая категория (с первой страницы); иначе дозагрузка следующей страницы. */
  const load = useCallback(
    async (reset: boolean) => {
      // Быстро переключили категорию дважды — ответ на старый запрос может прийти позже
      // нового и затереть список. Применяем только ответ на последний запрос.
      const requestId = ++lastRequest.current;
      setLoading(true);
      setError('');
      try {
        // Следующая страница — заказы старше последнего показанного (курсор, а не номер страницы).
        const shown = ordersRef.current;
        const res = await fetchOpenOrders(
          reset ? undefined : shown[shown.length - 1],
          category,
          platform,
        );
        if (requestId !== lastRequest.current) return;
        setOrders(reset ? res.items : [...shown, ...res.items]);
        setTotal(res.total);
        setHasMore(res.hasMore);
      } catch {
        if (requestId === lastRequest.current) setError(t('catalog.loadError'));
      } finally {
        if (requestId === lastRequest.current) setLoading(false);
      }
    },
    [category, platform, t],
  );

  // Сменилась категория или площадка — грузим заново, и сразу при открытии экрана.
  useEffect(() => void load(true), [load]);
  useEffect(() => {
    try {
      if (platform) localStorage.setItem(PLATFORM_KEY, platform);
      else localStorage.removeItem(PLATFORM_KEY);
    } catch {
      // без хранилища просто не запомним
    }
  }, [platform]);

  const filtered = Boolean(category || platform);
  const empty = !loading && !error && orders.length === 0;

  // Пустой каталог: предлагаем включить сообщения о новых заказах, если они выключены.
  // undefined — ещё не знаем (не показываем ни кнопку, ни текст про бота).
  const [notifyOn, setNotifyOn] = useState<boolean>();
  useEffect(() => {
    if (empty && notifyOn === undefined)
      fetchMyProfile().then(
        (p) => setNotifyOn(p.notifyNewOrders ?? true),
        () => {},
      );
  }, [empty, notifyOn]);
  async function notifyMe() {
    try {
      await updateNotifications(true);
      setNotifyOn(true);
    } catch {
      // не вышло — кнопка останется, можно нажать ещё раз
    }
  }

  function resetFilters() {
    setCategory(undefined);
    setPlatform(undefined);
  }

  return (
    <main className={s.catalog}>
      <header className={s.head}>
        <h1>{t('catalog.title')}</h1>
        <p>{t('catalog.subtitle')}</p>
      </header>

      <nav className={s.chips} aria-label={t('catalog.platformsAria')}>
        <button
          type="button"
          aria-pressed={!platform}
          onClick={() => setPlatform(undefined)}
        >
          {t('catalog.allPlatforms')}
        </button>
        {VIDEO_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={s.withIcon}
            aria-pressed={platform === p}
            onClick={() => setPlatform(p)}
          >
            <PlatformIcon
              platform={p}
              size={24}
              round
              inverse={platform === p}
            />
            {PLATFORM_NAMES[p]}
          </button>
        ))}
      </nav>

      <nav
        className={`${s.chips} ${s.soft}`}
        aria-label={t('catalog.categoriesAria')}
      >
        <button
          type="button"
          aria-pressed={!category}
          onClick={() => setCategory(undefined)}
        >
          {t('catalog.allCategories')}
        </button>
        {ORDER_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {categoryLabel(c)}
          </button>
        ))}
      </nav>

      {error ? (
        <LoadState error={error} onRetry={() => void load(true)} />
      ) : empty && filtered ? (
        <EmptyState
          title={t('catalog.filteredTitle')}
          text={t('catalog.filteredText')}
          icon={
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          }
        >
          <button type="button" className="main-button" onClick={resetFilters}>
            {t('catalog.resetFilters')}
          </button>
        </EmptyState>
      ) : empty ? (
        <EmptyState
          title={t('catalog.emptyTitle')}
          text={
            notifyOn === undefined
              ? undefined
              : notifyOn
                ? t('catalog.emptyNotifyOn')
                : t('catalog.emptyNotifyOff')
          }
          icon={
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          }
        >
          {notifyOn === false && (
            <button type="button" className="main-button" onClick={notifyMe}>
              {t('catalog.notifyMe')}
            </button>
          )}
        </EmptyState>
      ) : (
        total > 0 && (
          <h2 className={`section-title ${s.count}`}>
            {t('catalog.openCount', { count: total })}
          </h2>
        )
      )}

      {/* Первая загрузка — заготовки карточек вместо пустого экрана. */}
      {loading && orders.length === 0 && <LoadState />}
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}

      {hasMore && (
        <button
          type="button"
          className={s.more}
          disabled={loading}
          onClick={() => void load(false)}
        >
          {loading ? t('catalog.loading') : t('catalog.more')}
        </button>
      )}

      <footer className={s.footer}>
        <Link to="/learn" className="quiet-link">
          {t('catalog.howItWorks')}
        </Link>
        <SupportLink />
        <Link to="/privacy" className="quiet-link">
          {t('catalog.privacy')}
        </Link>
      </footer>
    </main>
  );
}
