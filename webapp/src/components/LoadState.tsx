import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import s from './LoadState.module.css';

/**
 * Пока экран грузится — заготовки карточек; не загрузился — ошибка и «Повторить».
 * Экран сам решает, когда показывать (нет данных или есть ошибка), и по `onRetry` грузит заново.
 */
export default function LoadState({
  error,
  onRetry,
}: {
  error?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (error)
    return (
      <EmptyState
        title={t('common.loadFailed')}
        text={error}
        role="alert"
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
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        }
      >
        <button type="button" className="main-button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </EmptyState>
    );
  return (
    <div className={s.skeletons} role="status" aria-label={t('common.loading')}>
      {[1, 2, 3].map((i) => (
        <div key={i} className={s.skeleton} aria-hidden="true">
          <span className={`${s.bone} ${s.short}`}></span>
          <span className={s.bone}></span>
          <span className={`${s.bone} ${s.mid}`}></span>
        </div>
      ))}
    </div>
  );
}
