import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserStats,
  errorText,
  fetchAdvertiserStats,
  PLATFORM_NAMES,
  safeUrl,
  sendStatsCsv,
  type StatsDays,
} from '../api';
import { PlatformIcon } from '../components/PlatformIcon';
import { formatDate, formatMoney, formatViews } from '../format';
import s from '../ui.module.css';

const PERIODS: { days: StatsDays; label: string }[] = [
  { days: 7, label: 'stats.days7' },
  { days: 30, label: 'stats.days30' },
  { days: undefined, label: 'stats.all' },
];

type OrderRow = AdvertiserStats['orders'][number];
type SortKey = 'views' | 'spent' | 'cpm' | 'videos' | 'clicks';
/** Столбцы таблицы заказов; цена 1000 просмотров — дешевле выше, остальное — больше выше. */
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'views', label: 'stats.views' },
  { key: 'spent', label: 'stats.spentCol' },
  { key: 'cpm', label: 'stats.cpm' },
  { key: 'videos', label: 'stats.videos' },
  { key: 'clicks', label: 'stats.clicks' },
];
const sortOrders = (rows: OrderRow[], key: SortKey) =>
  [...rows].sort((a, b) =>
    key === 'cpm'
      ? (a.cpm ?? Infinity) - (b.cpm ?? Infinity)
      : (b[key] ?? -1) - (a[key] ?? -1),
  );

/** Статистика заказчика по всем заказам — как в мини-аппе (webapp/src/views/StatsView.tsx). */
export function Stats() {
  const { t } = useTranslation();
  const [days, setDays] = useState<StatsDays>(30);
  const [data, setData] = useState<AdvertiserStats>();
  const [loadError, setLoadError] = useState('');
  const [sort, setSort] = useState<SortKey>('views');
  const [csvState, setCsvState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [csvError, setCsvError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    setData(undefined);
    setCsvState('idle');
    try {
      setData(await fetchAdvertiserStats(days));
    } catch (err) {
      setLoadError(errorText(err, t('stats.loadError')));
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
      setCsvError(errorText(err, t('review.csvError')));
    }
  }

  const sum = data?.summary;
  const maxPlatformViews = Math.max(
    0,
    ...(data?.platforms.map((p) => p.views) ?? []),
  );

  return (
    <div className={s.page}>
      <header>
        <h1>{t('stats.title')}</h1>
        <p className={s.hint}>{t('stats.subtitle')}</p>
      </header>
      <div
        className={s.chips}
        role="radiogroup"
        aria-label={t('stats.periodAria')}
      >
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            role="radio"
            aria-checked={days === p.days}
            onClick={() => setDays(p.days)}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {loadError ? (
        <div className={s.buttons}>
          <p className={s.hint}>{loadError}</p>
          <button type="button" className={s.btn} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      ) : !data || !sum ? (
        <p className={s.hint}>{t('common.loading')}</p>
      ) : !sum.videos ? (
        <p className={s.hint}>{t('stats.empty')}</p>
      ) : (
        <>
          <div className={s.tiles}>
            <div className={s.tile}>
              <strong>{formatViews(sum.views)}</strong>
              <span>
                {t('review.viewsLikes', { likes: formatViews(sum.likes) })}
              </span>
            </div>
            <div className={s.tile}>
              <strong>{formatMoney(sum.spent)}</strong>
              <span>{t('stats.spent')}</span>
            </div>
            <div className={s.tile}>
              <strong>{sum.videos}</strong>
              <span>
                {t('review.videosCreators', { creators: sum.creators })}
              </span>
            </div>
            <div className={s.tile}>
              <strong>{sum.cpm === null ? '—' : formatMoney(sum.cpm)}</strong>
              <span>{t('review.perThousand')}</span>
            </div>
            {sum.clicks !== null && (
              <div className={s.tile}>
                <strong>{formatViews(sum.clicks)}</strong>
                <span>
                  {t('review.clicks')}
                  {sum.clickRate !== null &&
                    ` · ${t('stats.clickRate', { rate: sum.clickRate })}`}
                </span>
              </div>
            )}
          </div>
          <p className={s.hint}>{t('stats.periodHint')}</p>

          <div className={`${s.twoCols} ${s.alignStart}`}>
            <section className={s.card}>
              <h2>{t('stats.daily')}</h2>
              <DailyChart daily={data.daily} />
              <p className={`${s.hint} ${s.small}`}>{t('stats.dailyHint')}</p>
            </section>
            <section className={s.card}>
              <h2>{t('stats.platforms')}</h2>
              {data.platforms.map((p) => (
                <div key={p.platform}>
                  <div className={s.row}>
                    <span className={s.check}>
                      <PlatformIcon platform={p.platform} size={22} round />
                      {PLATFORM_NAMES[p.platform]}
                    </span>
                    <span>
                      {t('stats.platformCpm', {
                        views: formatViews(p.views),
                        cpm: p.cpm === null ? '—' : formatMoney(p.cpm),
                      })}
                    </span>
                  </div>
                  <div className={s.bar} aria-hidden="true">
                    <span
                      style={{
                        width: `${maxPlatformViews ? (p.views / maxPlatformViews) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </section>
          </div>

          <h2>{t('stats.orders')}</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t('stats.order')}</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={s.num}
                      aria-sort={sort === c.key ? 'descending' : undefined}
                    >
                      {/* шапка таблицы — кнопка сортировки, вид как у заголовка */}
                      <button
                        type="button"
                        className={s.linkButton}
                        style={{ font: 'inherit', color: 'inherit' }}
                        onClick={() => setSort(c.key)}
                      >
                        {t(c.label)}
                        {sort === c.key && ' ↓'}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortOrders(data.orders, sort).map((o) => (
                  <tr key={o.id}>
                    <th scope="row">
                      <Link to={`/my-orders/${o.id}/report`}>{o.title}</Link>
                    </th>
                    <td className={s.num} data-label={t('stats.views')}>
                      {formatViews(o.views)}
                    </td>
                    <td className={s.num} data-label={t('stats.spentCol')}>
                      {formatMoney(o.spent)}
                    </td>
                    <td className={s.num} data-label={t('stats.cpm')}>
                      {o.cpm === null ? '—' : formatMoney(o.cpm)}
                    </td>
                    <td className={s.num} data-label={t('stats.videos')}>
                      {o.videos}
                    </td>
                    <td className={s.num} data-label={t('stats.clicks')}>
                      {o.clicks === null ? '—' : formatViews(o.clicks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{t('stats.top')}</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>{t('stats.creator')}</th>
                  <th className={s.num}>{t('stats.views')}</th>
                  <th className={s.num}>{t('stats.clicks')}</th>
                </tr>
              </thead>
              <tbody>
                {data.top.map((v) => (
                  <tr key={v.id}>
                    <th scope="row">
                      <span className={s.check}>
                        <PlatformIcon platform={v.platform} size={22} round />
                        {safeUrl(v.videoUrl) ? (
                          <a
                            href={safeUrl(v.videoUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('review.open')}
                          </a>
                        ) : (
                          PLATFORM_NAMES[v.platform]
                        )}
                      </span>
                    </th>
                    <td data-label={t('stats.creator')}>
                      {v.creator}
                      <small>
                        <Link to={`/my-orders/${v.orderId}/report`}>
                          {v.orderTitle}
                        </Link>
                        {v.approvedAt && ` · ${formatDate(v.approvedAt)}`}
                      </small>
                    </td>
                    <td className={s.num} data-label={t('stats.views')}>
                      {formatViews(v.views)}
                    </td>
                    <td className={s.num} data-label={t('stats.clicks')}>
                      {v.clicks === null ? '—' : formatViews(v.clicks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={s.buttons}>
            <button
              type="button"
              className={s.btn}
              disabled={csvState !== 'idle'}
              onClick={sendCsv}
            >
              {csvState === 'sent'
                ? t('review.csvSent')
                : csvState === 'sending'
                  ? t('common.sending')
                  : t('stats.csv')}
            </button>
          </div>
          {csvError && (
            <p className={s.error} role="alert">
              {csvError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Прирост просмотров по дням — столбики; число дня — в подсказке у столбика. */
function DailyChart({ daily }: { daily: AdvertiserStats['daily'] }) {
  const { t } = useTranslation();
  const max = Math.max(0, ...daily.map((d) => d.views));
  if (!max) return <p className={s.hint}>{t('stats.dailyEmpty')}</p>;
  const total = daily.reduce((sum, d) => sum + d.views, 0);
  return (
    <figure className={s.dailyChart}>
      <span className={`${s.hint} ${s.small}`}>{formatViews(max)}</span>
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
      <figcaption className={`${s.hint} ${s.small}`}>
        <span>{formatDate(daily[0].date)}</span>
        <span>{formatDate(daily[daily.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}
