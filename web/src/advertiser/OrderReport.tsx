import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  errorText,
  type Feedback,
  fetchOrderReport,
  type OrderReport as Report,
  PLATFORM_NAMES,
  rateVideo,
  safeUrl,
  sendReportCsv,
} from '../api';
import { Avatar } from '../components/Avatar';
import { Complaint } from '../components/Complaint';
import { PlatformIcon } from '../components/PlatformIcon';
import { formatDate, formatMoney, formatViews } from '../format';
import s from '../ui.module.css';

const EMPTY_FEEDBACK: Feedback = {
  rating: 0,
  review: '',
  portfolioAllowed: false,
};

/**
 * Отчёт по заказу и оценка роликов — как в мини-аппе (webapp/src/views/ReviewVideosView.tsx):
 * сводка и воронка сверху, ролики ниже. Ссылки на ролики — через наш редирект /v/ (без ника автора).
 */
export function OrderReport() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const [data, setData] = useState<Report>();
  const [loadError, setLoadError] = useState('');
  /** Порядок роликов: по просмотрам (как отдаёт сервер) или новые первыми. */
  const [sort, setSort] = useState<'views' | 'date'>('views');
  const [csvState, setCsvState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [csvError, setCsvError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await fetchOrderReport(id));
    } catch (err) {
      setLoadError(errorText(err, t('review.loadError')));
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
      setCsvError(errorText(err, t('review.csvError')));
    }
  }

  if (loadError)
    return (
      <div className={s.buttons}>
        <p className={s.hint}>{loadError}</p>
        <button type="button" className={s.btn} onClick={load}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!data) return <p className={s.hint}>{t('common.loading')}</p>;

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
    },
    { label: t('review.taken'), value: f.taken, percent: pct(f.taken) },
    {
      label: t('review.approvedShort'),
      value: f.approved,
      percent: pct(f.approved),
    },
  ];
  const maxPlatformViews = Math.max(0, ...data.platforms.map((p) => p.views));
  const spentPercent = Math.min(
    100,
    (data.summary.spent / data.summary.budget) * 100,
  );

  return (
    <div className={s.page}>
      <header>
        <p className={s.hint}>
          <Link to="/my-orders">{t('tabs.myOrders')}</Link> · {data.order.title}
        </p>
        <h1>{t('review.title')}</h1>
      </header>

      <div className={s.tiles}>
        <div className={s.tile}>
          <strong>{formatViews(data.summary.views)}</strong>
          <span>
            {t('review.viewsLikes', { likes: formatViews(data.summary.likes) })}
          </span>
        </div>
        <div className={s.tile}>
          <strong>{formatMoney(data.summary.spent)}</strong>
          <span>
            {t('review.spentOf', { budget: formatMoney(data.summary.budget) })}
            {!!data.summary.reserved &&
              t('review.reserved', {
                amount: formatMoney(data.summary.reserved),
              })}
          </span>
          <div className={s.bar} aria-hidden="true">
            <span style={{ width: `${spentPercent}%` }} />
          </div>
        </div>
        <div className={s.tile}>
          <strong>{data.summary.videos}</strong>
          <span>
            {t('review.videosCreators', { creators: data.summary.creators })}
          </span>
        </div>
        <div className={s.tile}>
          <strong>
            {data.summary.cpm === null ? '—' : formatMoney(data.summary.cpm)}
          </strong>
          <span>{t('review.perThousand')}</span>
        </div>
        {data.summary.clicks !== null && (
          <div className={s.tile}>
            <strong>{formatViews(data.summary.clicks)}</strong>
            <span>{t('review.clicks')}</span>
          </div>
        )}
      </div>
      <p className={s.hint}>
        {t('review.left', { amount: formatMoney(data.summary.left) })}
      </p>

      <div className={s.twoCols}>
        <section className={s.card}>
          <h2>{t('review.funnel')}</h2>
          {funnelBars.map((bar) => (
            <div key={bar.label}>
              <div className={s.row}>
                <span>{bar.label}</span>
                <span>{bar.value}</span>
              </div>
              <div className={s.bar} aria-hidden="true">
                <span style={{ width: `${bar.percent}%` }} />
              </div>
            </div>
          ))}
          <p className={`${s.hint} ${s.small}`}>
            {t('review.onReviewShort', { count: f.onReview })} ·{' '}
            {t('review.expiredShort', { count: f.expired })} ·{' '}
            {t('review.rejectedShort', { count: f.rejected })}
          </p>
        </section>

        {data.platforms.length > 0 && (
          <section className={s.card}>
            {data.platforms.map((p) => (
              <div key={p.platform}>
                <div className={s.row}>
                  <span className={s.check}>
                    <PlatformIcon platform={p.platform} size={22} round />
                    {PLATFORM_NAMES[p.platform]}
                  </span>
                  <span>
                    {t('review.platformViews', {
                      videos: p.videos,
                      views: formatViews(p.views),
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
        )}
      </div>

      {data.insights.map((i) => (
        <p key={i.code} className={s.alert}>
          {i.text}
        </p>
      ))}

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
              : t('review.csv')}
        </button>
      </div>
      {csvError && (
        <p className={s.error} role="alert">
          {csvError}
        </p>
      )}

      <div className={s.cardHead}>
        <h2>{t('review.videos')}</h2>
        <div
          className={s.chips}
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

      <div className={s.cards}>
        {items.map((item) => (
          <VideoItem
            key={item.id}
            item={item}
            onRated={(rating) =>
              setData(
                (d) =>
                  d && {
                    ...d,
                    items: d.items.map((i) =>
                      i.id === item.id ? { ...i, rating } : i,
                    ),
                  },
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

type Item = Report['items'][number];

/** Ролик в отчёте: креатор (ссылка на его профиль), ролик, оценка с отзывом и жалоба. */
function VideoItem({
  item,
  onRated,
}: {
  item: Item;
  onRated: (rating: number) => void;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(EMPTY_FEEDBACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Отзыв с текстом ушёл на проверку — подсказка под оценкой. */
  const [onModeration, setOnModeration] = useState(false);

  async function rate() {
    setBusy(true);
    setError('');
    try {
      const res = await rateVideo(item.id, feedback);
      setOnModeration(res.onModeration);
      onRated(feedback.rating);
      setRating(false);
    } catch (err) {
      setError(errorText(err, t('review.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <Link to={`/creators/${item.creatorId}`} className={s.check}>
          <Avatar userId={item.creatorId} name={item.creator} size={36} />
          <strong>{item.creator}</strong>
        </Link>
        {!!item.rating && (
          <span aria-label={t('review.yourRating', { rating: item.rating })}>
            {'★'.repeat(item.rating)}
            {'☆'.repeat(5 - item.rating)}
          </span>
        )}
      </div>
      <p className={`${s.hint} ${s.small}`}>
        {PLATFORM_NAMES[item.platform]} ·{' '}
        {t('review.itemViews', { views: formatViews(item.views) })}
        {item.likes !== null &&
          t('review.itemLikes', { likes: formatViews(item.likes) })}
        {item.clicks !== null &&
          t('review.itemClicks', { clicks: formatViews(item.clicks) })}
        {item.approvedAt && ` · ${formatDate(item.approvedAt)}`}
      </p>
      {safeUrl(item.videoUrl) ? (
        <a
          href={safeUrl(item.videoUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={s.videoLink}
        >
          <PlatformIcon platform={item.platform} size={36} inverse />
          <span>
            <strong>{t('review.open')}</strong>
            <small>{item.videoUrl}</small>
          </span>
        </a>
      ) : (
        <p className={s.hint}>{t('review.badUrl', { url: item.videoUrl })}</p>
      )}

      {onModeration && <p className={s.notice}>{t('review.thanks')}</p>}

      {rating ? (
        <fieldset className={s.fieldset}>
          <legend>{t('review.rateTitle')}</legend>
          <div
            className={s.chips}
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
                onClick={() => setFeedback({ ...feedback, rating: n })}
              >
                {'★'.repeat(n)}
              </button>
            ))}
          </div>
          <label className={s.field}>
            {t('review.reviewLabel')}
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
                setFeedback({ ...feedback, portfolioAllowed: e.target.checked })
              }
            />
            {t('review.portfolio')}
          </label>
          <div className={s.buttons}>
            <button
              type="button"
              className={`${s.btn} ${s.primary}`}
              disabled={busy || !feedback.rating}
              onClick={rate}
            >
              {t('review.rate')}
            </button>
            <button
              type="button"
              className={s.btn}
              disabled={busy}
              onClick={() => setRating(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        </fieldset>
      ) : (
        // оценку не меняют (бэкенд не даст) — кнопка только у неоценённых
        !item.rating && (
          <div className={s.buttons}>
            <button
              type="button"
              className={`${s.btn} ${s.primary}`}
              onClick={() => {
                setFeedback(EMPTY_FEEDBACK);
                setRating(true);
              }}
            >
              {t('review.rate')}
            </button>
          </div>
        )
      )}
      <Complaint
        target="VIDEO"
        targetId={item.id}
        label={t('review.reportVideo')}
      />
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
