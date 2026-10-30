import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { parseSupportAbout } from '@fixum/shared';
import { ApiError, sendSupportMessage } from '../api';
import EmptyState from '../components/EmptyState';
import s from './SupportView.module.css';

export default function SupportView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // /support?order=12 или ?topic=payout — тема; менеджеру её подпишет сервер
  const about = parseSupportAbout(useSearchParams()[0]);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      await sendSupportMessage(text, about);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('support.sendError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      {sent ? (
        <EmptyState
          title={t('support.sentTitle')}
          text={t('support.sentText')}
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
            <h1>{t('support.title')}</h1>
            <span className={s.hint}>{t('support.hint')}</span>
          </header>
          {about && (
            <p className={s.topic}>
              {'orderId' in about
                ? t('order.supportAbout', { id: about.orderId })
                : t('balance.supportAbout')}
            </p>
          )}
          <label className="field-label">
            <span>{t('support.label')}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              maxLength={1000}
              placeholder={t('support.placeholder')}
            />
          </label>
          <span className={s.counter} aria-hidden="true">
            {text.length} / 1000
          </span>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className="bottom-bar">
            <button
              type="button"
              className="main-button"
              disabled={busy || !text.trim()}
              onClick={send}
            >
              {busy ? t('common.sending') : t('common.send')}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
