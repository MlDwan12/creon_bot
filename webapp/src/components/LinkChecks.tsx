import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type CreatorProfile, verifyProfileLink } from '../api';
import { describeVideoUrl } from '../format';
import s from './LinkChecks.module.css';

type Check = NonNullable<CreatorProfile['linkChecks']>[number];

/**
 * Подтверждение аккаунтов кодом в описании — в своём профиле, по желанию. Код у каждой ссылки свой;
 * «Код добавлен» — ссылка уходит модератору. `onSent` — перезагрузить профиль со статусами.
 */
export default function LinkChecks({
  checks,
  onSent,
}: {
  checks: Check[];
  onSent: () => void;
}) {
  const { t } = useTranslation();
  /** Какая ссылка раскрыта — код и инструкция. */
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (!checks.length) return null;

  async function send(url: string) {
    setBusy(true);
    setError('');
    try {
      await verifyProfileLink(url);
      setOpen(undefined);
      onSent();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('linkCheck.error'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.checks}>
      <p className={s.hint}>{t('linkCheck.intro')}</p>
      {checks.map((c) => {
        const name = describeVideoUrl(c.url)?.short ?? c.url;
        const canSend = c.status === null || c.status === 'NO_CODE';
        return (
          <div key={c.url} className={s.check}>
            <div className={s.row}>
              <span className={s.name}>{name}</span>
              {c.status === 'VERIFIED' || c.status === 'PENDING' ? (
                <span
                  className={c.status === 'VERIFIED' ? s.verified : s.pending}
                >
                  {t(`linkCheck.status.${c.status}`)}
                </span>
              ) : (
                <button
                  type="button"
                  className={s.link}
                  onClick={() => {
                    setOpen(open === c.url ? undefined : c.url);
                    setCopied(false);
                  }}
                >
                  {t('linkCheck.verify')}
                </button>
              )}
            </div>
            {c.status === 'NO_CODE' && open !== c.url && (
              <p className={s.error}>{t('linkCheck.noCode')}</p>
            )}
            {open === c.url && canSend && (
              <div className={s.how}>
                <p className={s.hint}>{t('linkCheck.how')}</p>
                <button
                  type="button"
                  className={s.code}
                  onClick={() =>
                    void navigator.clipboard.writeText(c.code).then(
                      () => setCopied(true),
                      () => {},
                    )
                  }
                >
                  {c.code}
                  <small>
                    {copied ? t('linkCheck.copied') : t('linkCheck.copy')}
                  </small>
                </button>
                <button
                  type="button"
                  className={s.primary}
                  disabled={busy}
                  onClick={() => send(c.url)}
                >
                  {busy ? t('common.sending') : t('linkCheck.sent')}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
