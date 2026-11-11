import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createReport,
  errorText,
  reasonLabel,
  REPORT_REASONS,
  type ReportTarget,
} from '../api';
import s from '../ui.module.css';

/**
 * Жалоба на заказ, ролик, отзыв или профиль: ссылка, по нажатию — причины и комментарий на месте
 * (в мини-аппе — отдельный экран webapp/src/views/ReportView.tsx).
 */
export function Complaint({
  target,
  targetId,
  label,
}: {
  target: ReportTarget;
  targetId: number;
  label: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      await createReport({ target, targetId, reason, comment });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(errorText(err, t('report.sendError')));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className={s.notice}>{t('report.sentText')}</p>;
  if (!open)
    return (
      <button
        type="button"
        className={s.quietLink}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  return (
    <fieldset className={s.fieldset}>
      <legend>{t('report.whatsWrong')}</legend>
      {REPORT_REASONS[target].map((r) => (
        <label key={r} className={s.check}>
          <input
            type="radio"
            name={`reason-${target}-${targetId}`}
            checked={reason === r}
            onChange={() => setReason(r)}
          />
          {reasonLabel(target, r)}
        </label>
      ))}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={500}
        aria-label={t('report.commentOptional')}
        placeholder={
          reason === 'OTHER'
            ? t('report.describe')
            : t('report.commentOptional')
        }
      />
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.buttons}>
        <button
          type="button"
          className={`${s.btn} ${s.reject}`}
          // «Другое» без комментария бэкенд не примет
          disabled={busy || !reason || (reason === 'OTHER' && !comment.trim())}
          onClick={send}
        >
          {busy ? t('common.sending') : t('report.submit')}
        </button>
        <button
          type="button"
          className={s.btn}
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          {t('common.cancel')}
        </button>
      </div>
    </fieldset>
  );
}
