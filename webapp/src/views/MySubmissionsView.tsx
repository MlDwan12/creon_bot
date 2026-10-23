import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchMySubmissions, type MySubmission } from '../api';
import EmptyState from '../components/EmptyState';
import LoadState from '../components/LoadState';
import SubmissionCard from '../components/SubmissionCard';
import s from './MySubmissionsView.module.css';

const ACTIVE = ['IN_PROGRESS', 'SUBMITTED', 'MODERATOR_APPROVED'];

export default function MySubmissionsView() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'done'>('active');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchMySubmissions());
    } catch {
      setError(t('submissions.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  const active = items.filter((sub) => ACTIVE.includes(sub.status));
  /** Отклонённые и сгоревшие, по которым ещё можно прислать новую работу (только последнее видео по заказу). */
  const attention = items.filter(
    (sub) =>
      ['MODERATOR_REJECTED', 'ADVERTISER_REJECTED', 'SLOT_EXPIRED'].includes(
        sub.status,
      ) &&
      sub.latest &&
      sub.order.status === 'OPEN',
  );
  const done = items.filter(
    (sub) => !active.includes(sub) && !attention.includes(sub),
  );

  return (
    <main className={s.page}>
      <h1>{t('submissions.title')}</h1>

      <div
        className={s.segmented}
        role="tablist"
        aria-label={t('submissions.filterAria')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => setTab('active')}
        >
          {t('submissions.active', { count: active.length + attention.length })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'done'}
          onClick={() => setTab('done')}
        >
          {t('submissions.done', { count: done.length })}
        </button>
      </div>

      {loading || error ? (
        <LoadState error={error} onRetry={load} />
      ) : tab === 'active' ? (
        <>
          {active.length + attention.length === 0 && (
            <EmptyState
              title={t('submissions.emptyTitle')}
              text={t('submissions.emptyText')}
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
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M10 9.5v5l4.5-2.5z" />
                </svg>
              }
            >
              <Link to="/" className="main-button">
                {t('submissions.openCatalog')}
              </Link>
            </EmptyState>
          )}
          {active.map((sub) => (
            <SubmissionCard key={sub.id} submission={sub} />
          ))}
          {attention.length > 0 && (
            <>
              <h2 className={`section-title ${s.flush}`}>
                {t('submissions.attention')}
              </h2>
              {attention.map((sub) => (
                <SubmissionCard key={sub.id} submission={sub} />
              ))}
            </>
          )}
        </>
      ) : (
        <>
          {done.length === 0 && (
            <EmptyState
              title={t('submissions.emptyDoneTitle')}
              text={t('submissions.emptyDone')}
              icon={
                <svg
                  width="30"
                  height="30"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              }
            />
          )}
          {done.map((sub) => (
            <SubmissionCard key={sub.id} submission={sub} />
          ))}
        </>
      )}
    </main>
  );
}
