import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserAccess,
  ApiError,
  applyAdvertiser,
  fetchMyProfile,
} from '../api';
import EmptyState from '../components/EmptyState';
import LoadState from '../components/LoadState';
import SupportLink from '../components/SupportLink';
import { formatDate } from '../format';
import { advertiserCabinet } from '../role';
import s from './AdvertiserApplyView.module.css';

const icon = (
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
    <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" />
  </svg>
);

/**
 * «Стать заказчиком»: кабинет заказчика открывает команда после созвона. Без заявки — форма
 * (почта, телефон по желанию); дальше — что с заявкой: на рассмотрении, отказ с датой повтора,
 * кабинет открыт или закрыт модератором (тогда только через поддержку).
 */
export default function AdvertiserApplyView() {
  const { t } = useTranslation();
  const [access, setAccess] = useState<AdvertiserAccess | null>();
  const [loadError, setLoadError] = useState('');

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setAccess((await fetchMyProfile()).advertiser);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('profile.loadError'),
      );
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  // кабинет открыли, пока мини-апп был запущен: /api/me уже ответил по-старому — обновляем вкладки
  useEffect(() => {
    if (access?.state === 'open' || access?.state === 'closed')
      advertiserCabinet.set(access.state);
  }, [access]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await applyAdvertiser(email, phone);
      setAccess({ state: 'pending', retryAt: null });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('support.sendError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError || access === undefined)
    return (
      <main className={s.page}>
        <LoadState error={loadError} onRetry={load} />
      </main>
    );

  const state = access?.state ?? 'none';
  if (state !== 'none')
    return (
      <main className={s.page}>
        <EmptyState
          title={t(`apply.${state}Title`)}
          text={t(`apply.${state}Text`, {
            date: access?.retryAt ? formatDate(access.retryAt) : '',
          })}
          role="status"
          icon={icon}
        >
          {state === 'open' ? (
            <Link to="/my-orders" className="main-button">
              {t('apply.openCabinet')}
            </Link>
          ) : state === 'closed' ? (
            <SupportLink />
          ) : (
            <Link to="/profile" className="main-button">
              {t('common.done')}
            </Link>
          )}
        </EmptyState>
      </main>
    );

  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1>{t('apply.title')}</h1>
        <span className={s.hint}>{t('apply.hint')}</span>
      </header>
      <ol className={s.steps}>
        {(t('apply.steps', { returnObjects: true }) as string[]).map(
          (step, i) => (
            <li key={step}>
              <span className={s.num} aria-hidden="true">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ),
        )}
      </ol>
      <form className={s.form} onSubmit={send}>
        <label className="field-label">
          <span>{t('apply.email')}</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </label>
        <label className="field-label">
          <span>{t('apply.phone')}</span>
          <input
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 900 123-45-67"
            aria-describedby="apply-phone-hint"
          />
          <small id="apply-phone-hint" className={s.hint}>
            {t('apply.phoneHint')}
          </small>
        </label>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className="bottom-bar">
          <button
            type="submit"
            className="main-button"
            disabled={busy || !email.trim()}
          >
            {busy ? t('common.sending') : t('apply.send')}
          </button>
        </div>
      </form>
    </main>
  );
}
