import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  errorText,
  type OrderReport,
  shareReport,
  unshareReport,
} from '../api';
import s from '../ui.module.css';

/**
 * Ссылка на отчёт без входа — как в мини-аппе (webapp/src/components/ShareReport.tsx): создать,
 * скопировать, отозвать. Не задан адрес сайта (share.available) — блока нет.
 */
export function ShareReport({
  orderId,
  share,
}: {
  orderId: number;
  share: OrderReport['share'];
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(share.url);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  if (!share.available) return null;

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      setUrl(await action());
    } catch (err) {
      setError(errorText(err, t('share.error')));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
    } catch {
      // буфер обмена недоступен — ссылку можно выделить в поле
    }
  }

  return (
    <section className={s.card}>
      <h2>{t('share.title')}</h2>
      <p className={`${s.hint} ${s.small}`}>{t('share.hint')}</p>
      {url && (
        <label className={s.field}>
          {t('share.link')}
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </label>
      )}
      <div className={s.buttons}>
        {url ? (
          <>
            <button type="button" className={s.btn} onClick={copy}>
              {copied ? t('share.copied') : t('share.copy')}
            </button>
            <button
              type="button"
              className={s.btn}
              disabled={busy}
              onClick={() => run(() => unshareReport(orderId).then(() => null))}
            >
              {t('share.revoke')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={() => run(() => shareReport(orderId).then((r) => r.url))}
          >
            {busy ? t('common.sending') : t('share.create')}
          </button>
        )}
      </div>
      {url && <p className={`${s.hint} ${s.small}`}>{t('share.revokeHint')}</p>}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
