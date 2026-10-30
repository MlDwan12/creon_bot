import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  ApiError,
  type Balance,
  fetchBalance,
  fetchRate,
  requestPayout,
} from '../api';
import LoadState from '../components/LoadState';
import SupportLink from '../components/SupportLink';
import { approxRub, formatDate, formatMoney } from '../format';
import { locale } from '../i18n';
import s from './BalanceView.module.css';

/** Цвет метки заявки; текст — в словаре (balance.status). */
const TONE: Record<Balance['payouts'][number]['status'], string> = {
  REQUESTED: 'warn',
  PAID: 'success',
  REJECTED: 'danger',
};

/** TXy7…6tQ — целиком адрес виден в профиле. */
function shortWallet(w: string) {
  return w.length > 14 ? `${w.slice(0, 4)}…${w.slice(-6)}` : w;
}

export default function BalanceView() {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<Balance>();
  const [loadError, setLoadError] = useState('');
  // строка из поля: '' — пусто
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // курс — только подсказка «≈ … ₽», не загрузился — не показываем
  const [rubPerUsdt, setRubPerUsdt] = useState<number | null>(null);
  useEffect(() => void fetchRate().then(setRubPerUsdt), []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const b = await fetchBalance();
      setBalance(b);
      // выводим целые USDT, без центов
      setAmount(String(Math.floor(b.available) || ''));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('balance.loadError'),
      );
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await requestPayout(Number(amount));
      setSent(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : t('balance.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      <h1>{t('balance.title')}</h1>

      {loadError || !balance ? (
        <LoadState error={loadError} onRetry={load} />
      ) : (
        <>
          {/* Две плашки: что можно вывести сейчас и что ещё в холде (HOLD_DAYS после одобрения). */}
          <div className={s.tiles}>
            <section className={`${s.tile} ${s.total}`}>
              <span className={s.hint}>{t('balance.available')}</span>
              <strong>{formatMoney(balance.available)}</strong>
              {rubPerUsdt && (
                <span className={s.hint}>
                  {t('balance.rate', {
                    rub: approxRub(balance.available, rubPerUsdt),
                    rate: rubPerUsdt.toLocaleString(locale()),
                  })}
                </span>
              )}
            </section>
            <section className={`${s.tile} ${s.held}`}>
              <span className={s.hint}>{t('balance.held')}</span>
              <strong>{formatMoney(balance.held)}</strong>
              <span className={s.hint}>
                {balance.nextReleaseAt
                  ? t('balance.nextRelease', {
                      date: formatDate(balance.nextReleaseAt),
                    })
                  : t('balance.heldHint')}
              </span>
            </section>
          </div>
          <p className={s.hint}>
            {t('balance.summary', {
              earned: formatMoney(balance.earned),
              paid: formatMoney(balance.paid),
            })}
            {!!balance.requested &&
              t('balance.inRequest', {
                amount: formatMoney(balance.requested),
              })}
          </p>

          {sent ? (
            <p className={s.notice} role="status">
              {t('balance.sent')}
            </p>
          ) : balance.requested ? (
            <p className={s.hint}>
              {t('balance.pending', { amount: formatMoney(balance.requested) })}
            </p>
          ) : !balance.wallet ? (
            <p className={`${s.notice} ${s.ask}`}>
              {t('balance.needWallet')}{' '}
              <Link to="/profile">{t('balance.addWallet')}</Link>
            </p>
          ) : balance.available >= balance.minPayout ? (
            <form className={s.withdraw} onSubmit={withdraw}>
              <label htmlFor="amount" className="section-title">
                {t('balance.amount')}
              </label>
              <div className={s.amountRow}>
                <input
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  min={balance.minPayout}
                  max={Math.floor(balance.available)}
                  step="1"
                  required
                />
                <button
                  type="button"
                  className={s.all}
                  onClick={() =>
                    setAmount(String(Math.floor(balance.available)))
                  }
                >
                  {t('balance.all')}
                </button>
              </div>
              <div className={s.walletRow}>
                <span>
                  <small>{t('balance.wallet')}</small>
                  <strong>{shortWallet(balance.wallet)}</strong>
                </span>
                <Link to="/profile">{t('balance.changeWallet')}</Link>
              </div>
              <p className={s.hint}>{t('balance.walletHint')}</p>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="main-button"
                disabled={busy || !Number(amount)}
              >
                {busy ? t('common.sending') : t('balance.withdraw')}
              </button>
            </form>
          ) : (
            <p className={s.hint}>
              {t('balance.minPayout', {
                amount: formatMoney(balance.minPayout),
              })}
            </p>
          )}

          {balance.payouts.length > 0 && (
            <>
              <h2 className={`section-title ${s.flush}`}>
                {t('balance.history')}
              </h2>
              {balance.payouts.map((p) => (
                <article key={p.id} className={s.payout}>
                  <div className={s.row}>
                    <strong>{formatMoney(p.amount)}</strong>
                    <span className={`${s.badge} ${s[TONE[p.status]]}`}>
                      {t(`balance.status.${p.status}`)}
                    </span>
                  </div>
                  <span className={s.hint}>{formatDate(p.createdAt)}</span>
                  {p.comment && (
                    <p className={s.hint}>
                      {t('balance.reason', { reason: p.comment })}
                    </p>
                  )}
                </article>
              ))}
            </>
          )}

          <p className={s.hint}>{t('balance.perVideo')}</p>
          <SupportLink
            label={t('balance.supportLabel')}
            about={{ topic: 'payout' }}
          />
        </>
      )}
    </main>
  );
}
