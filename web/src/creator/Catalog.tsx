import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { OrderCard } from '../components/OrderCard';
import { PlatformIcon } from '../components/PlatformIcon';
import s from '../ui.module.css';

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

/** Каталог открытых заказов — как в мини-аппе (webapp/src/views/CatalogView.tsx), сеткой карточек. */
export function Catalog() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<OrderCategory>();
  const [platform, setPlatform] = useState<VideoPlatform | undefined>(
    readPlatform,
  );
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** Где есть открытые заказы — фильтры только с ними; undefined — ещё не знаем. */
  const [facets, setFacets] = useState<{
    categories: OrderCategory[];
    platforms: VideoPlatform[];
  }>();

  const lastRequest = useRef(0);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  /** reset — фильтр сменился (с первой страницы); иначе дозагрузка следующей страницы. */
  const load = useCallback(
    async (reset: boolean) => {
      // ответ на старый запрос может прийти позже нового и затереть список — применяем только последний
      const requestId = ++lastRequest.current;
      setLoading(true);
      setError(false);
      try {
        // следующая страница — заказы старше последнего показанного (курсор, а не номер страницы)
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
        if (res.facets) setFacets(res.facets);
      } catch {
        if (requestId === lastRequest.current) setError(true);
      } finally {
        if (requestId === lastRequest.current) setLoading(false);
      }
    },
    [category, platform],
  );
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

  // Чипы — только там, где есть заказы; выбранный остаётся, чтобы его можно было снять.
  const shownPlatforms = VIDEO_PLATFORMS.filter(
    (p) => p === platform || facets?.platforms.includes(p),
  );
  const shownCategories = ORDER_CATEGORIES.filter(
    (c) => c === category || facets?.categories.includes(c),
  );

  return (
    <div className={s.page}>
      <header>
        <h1>{t('catalog.title')}</h1>
        <p className={s.hint}>{t('catalog.subtitle')}</p>
      </header>

      {shownPlatforms.length > 0 && (
        <nav className={s.chips} aria-label={t('catalog.platformsAria')}>
          <button
            type="button"
            aria-pressed={!platform}
            onClick={() => setPlatform(undefined)}
          >
            {t('catalog.allPlatforms')}
          </button>
          {shownPlatforms.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={platform === p}
              onClick={() => setPlatform(p)}
            >
              <PlatformIcon
                platform={p}
                size={22}
                round
                inverse={platform === p}
              />
              {PLATFORM_NAMES[p]}
            </button>
          ))}
        </nav>
      )}
      {shownCategories.length > 0 && (
        <nav className={s.chips} aria-label={t('catalog.categoriesAria')}>
          <button
            type="button"
            aria-pressed={!category}
            onClick={() => setCategory(undefined)}
          >
            {t('catalog.allCategories')}
          </button>
          {shownCategories.map((c) => (
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
      )}

      {error ? (
        <div className={s.buttons}>
          <p className={s.hint}>{t('catalog.loadError')}</p>
          <button type="button" className={s.btn} onClick={() => load(true)}>
            {t('common.retry')}
          </button>
        </div>
      ) : empty && filtered ? (
        <div className={s.card}>
          <h2>{t('catalog.filteredTitle')}</h2>
          <p className={s.hint}>{t('catalog.filteredText')}</p>
          <div className={s.buttons}>
            <button
              type="button"
              className={`${s.btn} ${s.primary}`}
              onClick={() => {
                setCategory(undefined);
                setPlatform(undefined);
              }}
            >
              {t('catalog.resetFilters')}
            </button>
          </div>
        </div>
      ) : empty ? (
        <div className={s.card}>
          <h2>{t('catalog.emptyTitle')}</h2>
          {notifyOn !== undefined && (
            <p className={s.hint}>
              {notifyOn
                ? t('catalog.emptyNotifyOn')
                : t('catalog.emptyNotifyOff')}
            </p>
          )}
          {notifyOn === false && (
            <div className={s.buttons}>
              <button
                type="button"
                className={`${s.btn} ${s.primary}`}
                onClick={notifyMe}
              >
                {t('catalog.notifyMe')}
              </button>
            </div>
          )}
        </div>
      ) : (
        total > 0 && <h2>{t('catalog.openCount', { count: total })}</h2>
      )}

      {loading && orders.length === 0 && (
        <p className={s.hint}>{t('common.loading')}</p>
      )}
      <div className={s.cards}>
        {orders.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          className={`${s.btn} ${s.more}`}
          disabled={loading}
          onClick={() => load(false)}
        >
          {loading ? t('catalog.loading') : t('catalog.more')}
        </button>
      )}
    </div>
  );
}
