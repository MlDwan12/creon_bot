import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserStats,
  ApiError,
  fetchAdvertiserStats,
  PLATFORM_NAMES,
  sendStatsCsv,
  type StatsDays,
} from '../api';
import LoadState from '../components/LoadState';
import PlatformIcon from '../components/PlatformIcon';
import { formatDate, formatMoney, formatViews } from '../format';
import { safeUrl } from '../telegram';
// плитки, полосы и переключатель — как в отчёте заказа
import r from './ReviewVideosView.module.css';
import s from './StatsView.module.css';

const PERIODS: { days: StatsDays; label: string }[] = [
  { days: 7, label: 'stats.days7' },
  { days: 30, label: 'stats.days30' },
  { days: undefined, label: 'stats.all' },
];

type OrderRow = AdvertiserStats['orders'][number];
/** Сортировка заказов: просмотры, расход или цена 1000 просмотров (дешевле — выше). */
const SORTS: { key: 'views' | 'spent' | 'cpm'; label: string }[] = [
  { key: 'views', label: 'stats.views' },
  { key: 'spent', label: 'stats.spentCol' },
  { key: 'cpm', label: 'stats.cpm' },
];
const sortOrders = (rows: OrderRow[], key: (typeof SORTS)[number]['key']) =>
  key === 'cpm'
    ? [...rows].sort((a, b) => (a.cpm ?? Infinity) - (b.cpm ?? Infinity))
    : [...rows].sort((a, b) => b[key] - a[key]);

/** Статистика заказчика по всем заказам — вкладка кабинета (сайт: web/src/advertiser/Stats.tsx). */
export default function StatsView() {
  const { t } = useTranslation();
  const [days, setDays] = useState<StatsDays>(30);
  const [data, setData] = useState<AdvertiserStats>();
  const [loadError, setLoadError] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('views');
  const [csvState, setCsvState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [csvError, setCsvError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    setData(undefined);
    setCsvState('idle');
    try {
      setData(await fetchAdvertiserStats(days));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('stats.loadError'),
      );
    }
  }, [days, t]);
  useEffect(() => void load(), [load]);

  async function sendCsv() {
    setCsvState('sending');
    setCsvError('');
    try {
      await sendStatsCsv(days);
      setCsvState('sent');
    } catch (err) {
      setCsvState('idle');
      setCsvError(
        err instanceof ApiError ? err.userMessage : t('review.csvError'),
      );
    }
  }

  const sum = data?.summary;
  const maxPlatformViews = Math.max(
    0,
    ...(data?.platforms.map((p) => p.views) ?? []),
  );

  return (
    <main className={r.page}>
      <header className={r.head}>
        <h1>{t('stats.title')}</h1>
        <p className={r.hint}>{t('stats.subtitle')}</p>
      </header>
      <div
        className={r.segmented}
        role="radiogroup"
        aria-label={t('stats.periodAria')}
      >
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            role="radio"
            aria-checked={days === p.days}
            className={s.grow}
            onClick={() => setDays(p.days)}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {!data || !sum ? (
        <LoadState error={loadError} onRetry={load} />
      ) : !sum.videos ? (
        <p className={r.hint}>{t('stats.empty')}</p>
      ) : (
        <>
          <section className={r.hero}>
            <span className={`money ${r.views}`}>{formatViews(sum.views)}</span>
            <span className={r.hint}>
              {t('review.viewsLikes', { likes: formatViews(sum.likes) })}
            </span>
            <span className={r.hint}>
              <b>{formatMoney(sum.spent)}</b> {t('stats.spent')}
            </span>
          </section>
          <section className={r.kpis}>
            <div>
              <b>{sum.videos}</b>
              {t('review.videosCreators', { creators: sum.creators })}
            </div>
            <div>
              <b>{sum.cpm === null ? '—' : formatMoney(sum.cpm)}</b>
              {t('review.perThousand')}
            </div>
            {sum.clicks !== null && (
              <div>
                <b>{formatViews(sum.clicks)}</b>
                {t('review.clicks')}
              </div>
            )}
          </section>
          {sum.clickRate !== null && (
            <p className={r.hint}>
              {t('stats.clickRate', { rate: sum.clickRate })}
            </p>
          )}
          <p className={r.hint}>{t('stats.periodHint')}</p>

          <h2 className={`section-title ${r.flush}`}>{t('stats.daily')}</h2>
          <section className={r.bars}>
            <DailyChart daily={data.daily} />
            <p className={r.funnelRest}>{t('stats.dailyHint')}</p>
          </section>

          <div className={r.titleRow}>
            <h2 className={`section-title ${r.flush}`}>{t('stats.orders')}</h2>
            <div
              className={r.segmented}
              role="radiogroup"
              aria-label={t('stats.sortAria')}
            >
              {SORTS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={sort === o.key}
                  onClick={() => setSort(o.key)}
                >
                  {t(o.label)}
                </button>
              ))}
            </div>
          </div>
          <section className={s.list}>
            {sortOrders(data.orders, sort).map((o) => (
              <Link
                key={o.id}
                to={`/my-orders/${o.id}/review`}
                className={s.row}
              >
                <strong>{o.title}</strong>
                <span className={r.hint}>
                  {formatViews(o.views)} · {formatMoney(o.spent)} ·{' '}
                  {o.cpm === null ? '—' : formatMoney(o.cpm)}{' '}
                  {t('review.perThousand')} · {o.videos}{' '}
                  {t('stats.videos').toLowerCase()}
                  {o.clicks !== null &&
                    ` · ${formatViews(o.clicks)} ${t('stats.clicks').toLowerCase()}`}
                </span>
              </Link>
            ))}
          </section>

          <h2 className={`section-title ${r.flush}`}>{t('stats.platforms')}</h2>
          <section className={r.bars}>
            {data.platforms.map((p) => (
              <div key={p.platform} className={r.barRow}>
                <span className={r.platform}>
                  <PlatformIcon platform={p.platform} size={22} round />
                  {PLATFORM_NAMES[p.platform]}
                </span>
                <small className={r.right}>
                  {t('stats.platformCpm', {
                    views: formatViews(p.views),
                    cpm: p.cpm === null ? '—' : formatMoney(p.cpm),
                  })}
                </small>
                <div className={r.track} aria-hidden="true">
                  <span
                    style={{
                      width: `${maxPlatformViews ? (p.views / maxPlatformViews) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </section>

          <h2 className={`section-title ${r.flush}`}>{t('stats.top')}</h2>
          <section className={s.list}>
            {data.top.map((v) => (
              <a
                key={v.id}
                href={safeUrl(v.videoUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={s.row}
              >
                <span className={r.platform}>
                  <PlatformIcon platform={v.platform} size={22} round />
                  <strong>{formatViews(v.views)}</strong>
                </span>
                <span className={r.hint}>
                  {v.creator} · {v.orderTitle}
                  {v.approvedAt && ` · ${formatDate(v.approvedAt)}`}
                </span>
              </a>
            ))}
          </section>

          <button
            type="button"
            className={r.secondary}
            disabled={csvState !== 'idle'}
            onClick={sendCsv}
          >
            {csvState === 'sent'
              ? t('review.csvSent')
              : csvState === 'sending'
                ? t('common.sending')
                : t('stats.csv')}
          </button>
          {csvError && (
            <p className={r.error} role="alert">
              {csvError}
            </p>
          )}
        </>
      )}
    </main>
  );
}

/** Прирост просмотров по дням — столбики; число дня — в подсказке у столбика. */
function DailyChart({ daily }: { daily: AdvertiserStats['daily'] }) {
  const { t } = useTranslation();
  const max = Math.max(0, ...daily.map((d) => d.views));
  if (!max) return <p className={r.hint}>{t('stats.dailyEmpty')}</p>;
  const total = daily.reduce((sum, d) => sum + d.views, 0);
  return (
    <figure className={s.chart}>
      <span className={r.hint}>{formatViews(max)}</span>
      <svg
        viewBox={`0 0 ${daily.length * 10} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('stats.dailyAria', { views: formatViews(total) })}
      >
        {daily.map((d, i) => (
          <rect
            key={d.date}
            x={i * 10 + 1}
            width={8}
            // ненулевой день — хотя бы 2% высоты, чтобы был виден
            y={100 - (d.views ? Math.max(2, (d.views / max) * 100) : 0)}
            height={d.views ? Math.max(2, (d.views / max) * 100) : 0}
            rx={1}
          >
            <title>
              {t('stats.dayViews', {
                date: formatDate(d.date),
                views: formatViews(d.views),
              })}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className={r.hint}>
        <span>{formatDate(daily[0].date)}</span>
        <span>{formatDate(daily[daily.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}
