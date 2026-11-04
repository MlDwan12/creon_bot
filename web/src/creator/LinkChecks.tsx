import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CreatorProfile, errorText, verifyProfileLink } from '../api';
import { describeVideoUrl } from '../format';
import s from '../ui.module.css';

type Check = NonNullable<CreatorProfile['linkChecks']>[number];

/**
 * Подтверждение аккаунтов кодом в описании — как в мини-аппе (webapp/src/components/LinkChecks.tsx). Код у каждой ссылки свой;
 * «Код добавлен» — ссылка уходит модератору. `onSent` — перезагрузить профиль со статусами.
 */
export function LinkChecks({
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
      setError(errorText(err, t('linkCheck.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <p className={`${s.hint} ${s.small}`}>{t('linkCheck.intro')}</p>
      {checks.map((c) => {
        const name = describeVideoUrl(c.url)?.short ?? c.url;
        const canSend = c.status === null || c.status === 'NO_CODE';
        return (
          <div key={c.url} className={s.card}>
            <div className={s.row}>
              <span className={s.small}>{name}</span>
              {c.status === 'VERIFIED' || c.status === 'PENDING' ? (
                <span
                  className={`${s.badge} ${c.status === 'VERIFIED' ? s.success : s.warn}`}
                >
                  {t(`linkCheck.status.${c.status}`)}
                </span>
              ) : (
                <button
                  type="button"
                  className={s.btn}
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
              <div className={s.buttons}>
                <p className={`${s.hint} ${s.small}`}>{t('linkCheck.how')}</p>
                <button
                  type="button"
                  className={s.btn}
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
                  className={`${s.btn} ${s.primary}`}
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
