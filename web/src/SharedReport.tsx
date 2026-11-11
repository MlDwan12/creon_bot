import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSharedReport, PLATFORM_NAMES, safeUrl } from './api';
import type { PublicReport } from '@fixum/shared';
import { PlatformIcon } from './components/PlatformIcon';
import { formatDate, formatMoney, formatViews } from './format';
import { Logo } from './Login';
import s from './ui.module.css';

/**
 * Отчёт по публичной ссылке /share/<токен> — без входа и без меню сайта (main.tsx): заказчик
 * пересылает его руководителю. Только просмотр; ролики — через наш редирект /v/ (без ника автора).
 */
export function SharedReport({ token }: { token: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<PublicReport>();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    fetchSharedReport(token).then(setData, () => setGone(true));
  }, [token]);

  const body = gone ? (
    <p className={s.hint}>{t('share.publicGone')}</p>
  ) : !data ? (
    <p className={s.hint}>{t('common.loading')}</p>
  ) : (
    <Report data={data} />
  );
  return (
    <div
      className={s.page}
      style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}
    >
      <Logo />
      {body}
      <p className={`${s.hint} ${s.small}`}>{t('share.by')}</p>
    </div>
  );
}

function Report({ data }: { data: PublicReport }) {
  const { t } = useTranslation();
  const { summary } = data;
  const maxPlatformViews = Math.max(0, ...data.platforms.map((p) => p.views));
  return (
    <>
      <header>
        <p className={s.hint}>{t('share.publicTitle')}</p>
        <h1>{data.order.title}</h1>
      </header>

      <div className={s.tiles}>
        <div className={s.tile}>
          <strong>{formatViews(summary.views)}</strong>
          <span>
            {t('review.viewsLikes', { likes: formatViews(summary.likes) })}
          </span>
        </div>
        <div className={s.tile}>
          <strong>{formatMoney(summary.spent)}</strong>
          <span>{t('share.spent')}</span>
        </div>
        <div className={s.tile}>
          <strong>{summary.videos}</strong>
          <span>
            {t('review.videosCreators', { creators: summary.creators })}
          </span>
        </div>
        <div className={s.tile}>
          <strong>
            {summary.cpm === null ? '—' : formatMoney(summary.cpm)}
          </strong>
          <span>{t('review.perThousand')}</span>
        </div>
        {summary.clicks !== null && (
          <div className={s.tile}>
            <strong>{formatViews(summary.clicks)}</strong>
            <span>{t('review.clicks')}</span>
          </div>
        )}
      </div>

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

      <h2>{t('review.videos')}</h2>
      {data.items.length === 0 && <p className={s.hint}>{t('review.empty')}</p>}
      <div className={s.cards}>
        {data.items.map((item, i) => (
          <article key={i} className={s.card}>
            <strong>{item.creator}</strong>
            <p className={`${s.hint} ${s.small}`}>
              {PLATFORM_NAMES[item.platform]} ·{' '}
              {t('review.itemViews', { views: formatViews(item.views) })}
              {item.likes !== null &&
                t('review.itemLikes', { likes: formatViews(item.likes) })}
              {item.clicks !== null &&
                t('review.itemClicks', { clicks: formatViews(item.clicks) })}
              {item.approvedAt && ` · ${formatDate(item.approvedAt)}`}
            </p>
            {safeUrl(item.videoUrl) && (
              <a
                href={safeUrl(item.videoUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={s.videoLink}
              >
                <PlatformIcon platform={item.platform} size={32} inverse />
                <strong>{t('review.open')}</strong>
                <em>{PLATFORM_NAMES[item.platform]}</em>
              </a>
            )}
          </article>
        ))}
      </div>
      <p className={`${s.hint} ${s.small}`}>{t('share.publicNote')}</p>
    </>
  );
}
