import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorText, sendSupportMessage } from './api';
import s from './ui.module.css';

/** Сообщение менеджеру — как в мини-аппе (webapp/src/views/SupportView.tsx); ответ придёт в чат с ботом. */
export function Support() {
  const { t } = useTranslation();
  // /support?about=… — «Вопрос по заказу #12»: тема уходит менеджеру вместе с текстом
  const about = useSearchParams()[0].get('about') ?? '';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      await sendSupportMessage(about ? `${about}\n\n${text}` : text);
      setSent(true);
    } catch (err) {
      setError(errorText(err, t('support.sendError')));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className={s.page}>
        <h1>{t('support.sentTitle')}</h1>
        <p className={s.hint}>{t('support.sentText')}</p>
      </div>
    );
  return (
    <div className={`${s.page} ${s.narrow}`}>
      <header>
        <h1>{t('support.title')}</h1>
        <p className={s.hint}>{t('support.hint')}</p>
      </header>
      {about && <p className={s.alert}>{about}</p>}
      <label className={s.field}>
        <span className={s.cardHead}>
          {t('support.label')}
          <small className={s.muted}>{text.length} / 1000</small>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          maxLength={1000}
          placeholder={t('support.placeholder')}
        />
      </label>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.buttons}>
        <button
          type="button"
          className={`${s.btn} ${s.primary}`}
          disabled={busy || !text.trim()}
          onClick={send}
        >
          {busy ? t('common.sending') : t('common.send')}
        </button>
      </div>
    </div>
  );
}
