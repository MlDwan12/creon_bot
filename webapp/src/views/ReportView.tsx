import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ApiError,
  createReport,
  reasonLabel,
  REPORT_REASONS,
  type ReportTarget,
} from '../api';
import EmptyState from '../components/EmptyState';
import s from './ReportView.module.css';

export default function ReportView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // /report?target=ORDER&id=12&title=… — одна форма на все жалобы; title только для заголовка.
  const [query] = useSearchParams();
  const target = query.get('target') as ReportTarget;
  const targetId = Number(query.get('id'));
  const title = query.get('title') ?? '';
  const valid = target in REPORT_REASONS && Number.isInteger(targetId);
  const reasons = valid ? REPORT_REASONS[target] : [];

  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  /** «Другое» без комментария бэкенд не примет — не даём и отправить. */
  const canSend = reason && (reason !== 'OTHER' || comment.trim()) && !busy;

  async function send() {
    setBusy(true);
    setError('');
    try {
      await createReport({ target, targetId, reason, comment });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('report.sendError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      {!valid ? (
        <p className={s.hint}>{t('report.invalid')}</p>
      ) : sent ? (
        <EmptyState
          title={t('report.sentTitle')}
          text={t('report.sentText')}
          role="status"
          icon={
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          }
        >
          <button
            type="button"
            className="main-button"
            onClick={() => void navigate(-1)}
          >
            {t('common.done')}
          </button>
        </EmptyState>
      ) : (
        <>
          <header className={s.head}>
            <h1>{t(`report.heading.${target}`)}</h1>
            {title && <span className={s.hint}>{title}</span>}
          </header>

          <fieldset className={s.reasons}>
            <legend className="section-title">{t('report.whatsWrong')}</legend>
            {reasons.map((r) => (
              <label key={r} className={s.reason}>
                <span>{reasonLabel(target, r)}</span>
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
              </label>
            ))}
          </fieldset>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
            required={reason === 'OTHER'}
            aria-describedby={reason === 'OTHER' ? 'other-required' : undefined}
            placeholder={
              reason === 'OTHER'
                ? t('report.describe')
                : t('report.commentOptional')
            }
          />
          {reason === 'OTHER' && (
            <p id="other-required" className={`${s.hint} ${s.small}`}>
              {t('report.otherRequired')}
            </p>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}

          <div className="bottom-bar">
            <button
              type="button"
              className="main-button"
              disabled={!canSend}
              onClick={send}
            >
              {busy ? t('common.sending') : t('report.submit')}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
