import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  type Feedback,
  fetchOrderReport,
  type OrderReport,
  PLATFORM_NAMES,
  rateVideo,
  sendReportCsv,
} from '../api';
import LoadState from '../components/LoadState';
import PlatformIcon from '../components/PlatformIcon';
import SupportLink from '../components/SupportLink';
import UserAvatar from '../components/UserAvatar';
import { formatDate, formatMoney, formatViews } from '../format';
import { safeUrl } from '../telegram';
import s from './ReviewVideosView.module.css';

const EMPTY_FEEDBACK: Feedback = {
  rating: 0,
  review: '',
  portfolioAllowed: false,
};

export default function ReviewVideosView() {
  const { t } = useTranslation();
  // id заказа — из адреса /my-orders/:id/review
  const id = Number(useParams().id);

  const [data, setData] = useState<OrderReport>();
  const [loadError, setLoadError] = useState('');
  /** Порядок роликов: по просмотрам (как отдаёт сервер) или новые первыми. */
  const [sort, setSort] = useState<'views' | 'date'>('views');
  const [csvState, setCsvState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [csvError, setCsvError] = useState('');
  /** Какой ролик сейчас оценивают — форма открыта только у него. */
  const [rating, setRating] = useState<number>();
  const [feedback, setFeedback] = useState<Feedback>(EMPTY_FEEDBACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Ролики, чей отзыв только что ушёл на проверку, — подсказка под оценкой. */
  const [onModeration, setOnModeration] = useState(new Set<number>());

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await fetchOrderReport(id));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('review.loadError'),
      );
    }
  }, [id, t]);
  useEffect(() => void load(), [load]);

  async function sendCsv() {
    setCsvState('sending');
    setCsvError('');
    try {
      await sendReportCsv(id);
      setCsvState('sent');
    } catch (err) {
      setCsvState('idle');
      setCsvError(
        err instanceof ApiError ? err.userMessage : t('review.csvError'),
      );
    }
  }

  function startRating(itemId: number) {
    setRating(itemId);
    setError('');
    setFeedback(EMPTY_FEEDBACK);
  }

  async function rate() {
    setBusy(true);
    setError('');
    try {
      const { onModeration: queued } = await rateVideo(rating!, feedback);
      if (queued) setOnModeration((set) => new Set(set).add(rating!));
      setData(
        (d) =>
          d && {
            ...d,
            items: d.items.map((i) =>
              i.id === rating ? { ...i, rating: feedback.rating } : i,
            ),
          },
      );
      setRating(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : t('review.error'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError || !data)
    return (
      <main className={s.page}>
        <LoadState error={loadError} onRetry={load} />
      </main>
    );

  const items =
    sort === 'views'
      ? data.items
      : [...data.items].sort((a, b) =>
          (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''),
        );
  /** Воронка полосами: открыли → взяли → одобрено; доля — от открывших карточку. */
  const f = data.funnel;
  const pct = (n: number) =>
    f.viewers ? Math.round((n / f.viewers) * 100) : 0;
  const funnelBars = [
    {
      label: t('review.viewers'),
      value: f.viewers,
      percent: f.viewers ? 100 : 0,
      tone: '',
    },
    {
      label: t('review.taken'),
      value: f.taken,
      percent: pct(f.taken),
      tone: '',
    },
    {
      label: t('review.approvedShort'),
      value: f.approved,
      percent: pct(f.approved),
      tone: s.ok,
    },
  ];
  const maxPlatformViews = Math.max(0, ...data.platforms.map((p) => p.views));

  return (
    <main className={s.page}>
      <header className={s.head}>
        <span className={s.hint}>{data.order.title}</span>
        <h1>{t('review.title')}</h1>
      </header>

      <section className={s.hero}>
        <span className={`money ${s.views}`}>
          {formatViews(data.summary.views)}
        </span>
        <span className={s.hint}>
          {t('review.viewsLikes', { likes: formatViews(data.summary.likes) })}
        </span>
        <div className={s.bar} aria-hidden="true">
          <span
            style={{
              width: `${Math.min(100, (data.summary.spent / data.summary.budget) * 100)}%`,
            }}
          />
        </div>
        <span className={s.hint}>
          <b>{formatMoney(data.summary.spent)}</b>{' '}
          {t('review.spentOf', { budget: formatMoney(data.summary.budget) })}
          {!!data.summary.reserved &&
            t('review.reserved', {
              amount: formatMoney(data.summary.reserved),
            })}
        </span>
      </section>
      <section className={s.kpis}>
        <div>
          <b>{data.summary.videos}</b>
          {t('review.videosCreators', { creators: data.summary.creators })}
        </div>
        <div>
          <b>
            {data.summary.cpm === null ? '—' : formatMoney(data.summary.cpm)}
          </b>
          {t('review.perThousand')}
        </div>
        {data.summary.clicks !== null && (
          <div>
            <b>{formatViews(data.summary.clicks)}</b>
            {t('review.clicks')}
          </div>
        )}
      </section>
      <p className={s.hint}>
        {t('review.left', { amount: formatMoney(data.summary.left) })}
      </p>

      <h2 className={`section-title ${s.flush}`}>{t('review.funnel')}</h2>
      <section className={s.bars}>
        {funnelBars.map((bar) => (
          <div key={bar.label} className={s.barRow}>
            <span>{bar.label}</span>
            <b>{bar.value}</b>
            <div className={s.track} aria-hidden="true">
              <span
                className={bar.tone || undefined}
                style={{ width: `${bar.percent}%` }}
              />
            </div>
          </div>
        ))}
        <p className={s.funnelRest}>
          {t('review.onReviewShort', { count: f.onReview })} ·{' '}
          {t('review.expiredShort', { count: f.expired })} ·{' '}
          {t('review.rejectedShort', { count: f.rejected })}
        </p>
      </section>

      {data.insights.map((i) => (
        <article key={i.code} className={s.insight}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" />
          </svg>
          <p>{i.text}</p>
        </article>
      ))}

      {data.platforms.length > 0 && (
        <section className={s.bars}>
          {data.platforms.map((p) => (
            <div key={p.platform} className={s.barRow}>
              <span className={s.platform}>
                <PlatformIcon platform={p.platform} size={22} round />
                {PLATFORM_NAMES[p.platform]}
              </span>
              <small className={s.right}>
                {t('review.platformViews', {
                  videos: p.videos,
                  views: formatViews(p.views),
                })}
              </small>
              <div className={s.track} aria-hidden="true">
                <span
                  style={{
                    width: `${maxPlatformViews ? (p.views / maxPlatformViews) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      <button
        type="button"
        className={s.secondary}
        disabled={csvState !== 'idle'}
        onClick={sendCsv}
      >
        {csvState === 'sent'
          ? t('review.csvSent')
          : csvState === 'sending'
            ? t('common.sending')
            : t('review.csv')}
      </button>
      {csvError && (
        <p className={s.error} role="alert">
          {csvError}
        </p>
      )}

      <div className={s.titleRow}>
        <h2 className={`section-title ${s.flush}`}>{t('review.videos')}</h2>
        <div
          className={s.segmented}
          role="radiogroup"
          aria-label={t('review.order')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={sort === 'views'}
            onClick={() => setSort('views')}
          >
            {t('review.byViews')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sort === 'date'}
            onClick={() => setSort('date')}
          >
            {t('review.newest')}
          </button>
        </div>
      </div>
      <p className={s.hint}>{t('review.hint')}</p>

      {data.items.length === 0 && <p className={s.hint}>{t('review.empty')}</p>}

      {items.map((item) => (
        <article key={item.id} className={s.item}>
          <Link to={`/creators/${item.creatorId}`} className={s.creator}>
            <UserAvatar userId={item.creatorId} name={item.creator} />
            <div className={s.who}>
              <div className={s.name}>{item.creator}</div>
              <div className={s.hint}>
                {PLATFORM_NAMES[item.platform]} ·{' '}
                {t('review.itemViews', { views: formatViews(item.views) })}
                {item.likes !== null &&
                  t('review.itemLikes', { likes: formatViews(item.likes) })}
                {item.clicks !== null &&
                  t('review.itemClicks', { clicks: formatViews(item.clicks) })}
                {item.approvedAt && ` · ${formatDate(item.approvedAt)}`}
              </div>
            </div>
            <span className={s.chevron} aria-hidden="true">
              ›
            </span>
          </Link>

          {safeUrl(item.videoUrl) ? (
            <a
              href={safeUrl(item.videoUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className={s.video}
            >
              <span className={s.play} aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </span>
              <span className={s.link}>
                <span className={s.url}>{item.videoUrl}</span>
                <strong>{t('review.open')}</strong>
              </span>
            </a>
          ) : (
            <p className={s.hint}>
              {t('review.badUrl', { url: item.videoUrl })}
            </p>
          )}

          {!!item.rating && (
            <p
              className={s.rated}
              aria-label={t('review.yourRating', { rating: item.rating })}
            >
              {'★'.repeat(item.rating)}
              {'☆'.repeat(5 - item.rating)}
            </p>
          )}
          {onModeration.has(item.id) ? (
            <p className={s.hint}>{t('review.thanks')}</p>
          ) : rating === item.id ? (
            <fieldset className={s.feedback}>
              <legend className="section-title">{t('review.rateTitle')}</legend>
              <div
                className={s.stars}
                role="radiogroup"
                aria-label={t('review.rating')}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={feedback.rating === n}
                    aria-label={t('review.outOf', { n })}
                    className={n <= feedback.rating ? s.on : undefined}
                    onClick={() => setFeedback({ ...feedback, rating: n })}
                  >
                    <svg
                      width="30"
                      height="30"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" />
                    </svg>
                  </button>
                ))}
              </div>
              <label className="field-label">
                <span>{t('review.reviewLabel')}</span>
                <textarea
                  value={feedback.review}
                  onChange={(e) =>
                    setFeedback({ ...feedback, review: e.target.value })
                  }
                  rows={3}
                  maxLength={500}
                  placeholder={t('review.reviewPlaceholder')}
                />
              </label>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={feedback.portfolioAllowed}
                  onChange={(e) =>
                    setFeedback({
                      ...feedback,
                      portfolioAllowed: e.target.checked,
                    })
                  }
                />
                {t('review.portfolio')}
              </label>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <div className={s.two}>
                <button
                  type="button"
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => setRating(undefined)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="main-button"
                  disabled={busy || !feedback.rating}
                  onClick={rate}
                >
                  {t('review.rate')}
                </button>
              </div>
            </fieldset>
          ) : (
            // оценку не меняют и снятую не ставят заново (бэкенд не даст)
            item.rateable && (
              <button
                type="button"
                className={s.secondary}
                onClick={() => startRating(item.id)}
              >
                {t('review.rate')}
              </button>
            )
          )}

          <Link
            to={`/report?${new URLSearchParams({
              target: 'VIDEO',
              id: String(item.id),
              title: t('review.videoFrom', { name: item.creator }),
            })}`}
            className="quiet-link"
          >
            {t('review.reportVideo')}
          </Link>
        </article>
      ))}

      <SupportLink
        label={t('order.supportLabel', { id: data.order.id })}
        about={t('order.supportAbout', {
          id: data.order.id,
          title: data.order.title,
        })}
      />
    </main>
  );
}
