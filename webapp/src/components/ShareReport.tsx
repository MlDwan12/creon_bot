import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type OrderReport, shareReport, unshareReport } from '../api';
import s from './ShareReport.module.css';

/**
 * Ссылка на отчёт для тех, у кого нет входа (руководитель заказчика): создать, скопировать,
 * отозвать. Не задан адрес сайта (share.available) — блока нет.
 */
export default function ShareReport({
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
      setError(err instanceof ApiError ? err.userMessage : t('share.error'));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
    } catch {
      // буфер обмена недоступен (старый WebView) — ссылку можно выделить в поле
    }
  }

  return (
    <section className={s.share}>
      <h2 className="section-title">{t('share.title')}</h2>
      <p className={s.hint}>{t('share.hint')}</p>
      {url ? (
        <>
          <input
            className={s.url}
            value={url}
            readOnly
            aria-label={t('share.link')}
            onFocus={(e) => e.target.select()}
          />
          <div className={s.two}>
            <button type="button" className={s.button} onClick={copy}>
              {copied ? t('share.copied') : t('share.copy')}
            </button>
            <button
              type="button"
              className={s.button}
              disabled={busy}
              onClick={() => run(() => unshareReport(orderId).then(() => null))}
            >
              {t('share.revoke')}
            </button>
          </div>
          <p className={s.hint}>{t('share.revokeHint')}</p>
        </>
      ) : (
        <button
          type="button"
          className={s.button}
          disabled={busy}
          onClick={() => run(() => shareReport(orderId).then((r) => r.url))}
        >
          {busy ? t('common.sending') : t('share.create')}
        </button>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
