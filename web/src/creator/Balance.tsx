import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type Balance as BalanceData,
  errorText,
  fetchBalance,
  fetchRate,
  requestPayout,
} from '../api';
import { approxRub, formatDate, formatMoney } from '../format';
import { locale } from '../i18n';
import s from '../ui.module.css';

/** Цвет метки заявки; текст — в словаре (balance.status). */
const TONE: Record<
  BalanceData['payouts'][number]['status'],
  'warn' | 'success' | 'danger'
> = {
  REQUESTED: 'warn',
  PAID: 'success',
  REJECTED: 'danger',
};

/** TXy7…6tQ — целиком адрес виден в профиле. */
function shortWallet(w: string) {
  return w.length > 14 ? `${w.slice(0, 4)}…${w.slice(-6)}` : w;
}

/**
 * Баланс и вывод — как в мини-аппе (webapp/src/views/BalanceView.tsx). Вывод — только со свежего
 * входа: если вход старше часа, API попросит войти заново (окно в App.tsx).
 */
export function Balance() {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<BalanceData>();
  const [loadError, setLoadError] = useState('');
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
      setLoadError(errorText(err, t('balance.loadError')));
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
      setError(errorText(err, t('balance.error')));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <div className={s.buttons}>
        <p className={s.hint}>{loadError}</p>
        <button type="button" className={s.btn} onClick={load}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!balance) return <p className={s.hint}>{t('common.loading')}</p>;

  return (
    <div className={`${s.page} ${s.narrow}`}>
      <h1>{t('balance.title')}</h1>
      <div className={s.twoCols}>
        <section className={s.tile}>
          <span>{t('balance.available')}</span>
          <strong>{formatMoney(balance.available)}</strong>
          {rubPerUsdt && (
            <span>
              {t('balance.rate', {
                rub: approxRub(balance.available, rubPerUsdt),
                rate: rubPerUsdt.toLocaleString(locale()),
              })}
            </span>
          )}
        </section>
        <section className={s.tile}>
          <span>{t('balance.held')}</span>
          <strong>{formatMoney(balance.held)}</strong>
          <span>
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
          t('balance.inRequest', { amount: formatMoney(balance.requested) })}
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
        <p className={s.alert}>
          {t('balance.needWallet')}{' '}
          <Link to="/profile">{t('balance.addWallet')}</Link>
        </p>
      ) : balance.available >= balance.minPayout ? (
        <form className={s.card} onSubmit={withdraw}>
          <div className={s.inputRow}>
            <label className={s.field}>
              {t('balance.amount')}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min={balance.minPayout}
                max={Math.floor(balance.available)}
                step="1"
                required
              />
            </label>
            <button
              type="button"
              className={`${s.btn} ${s.selfEnd}`}
              onClick={() => setAmount(String(Math.floor(balance.available)))}
            >
              {t('balance.all')}
            </button>
          </div>
          <div className={s.row}>
            <span>{t('balance.wallet')}</span>
            <span>
              {shortWallet(balance.wallet)} ·{' '}
              <Link to="/profile">{t('balance.changeWallet')}</Link>
            </span>
          </div>
          <p className={`${s.hint} ${s.small}`}>{t('balance.walletHint')}</p>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className={`${s.btn} ${s.primary}`}
            disabled={busy || !Number(amount)}
          >
            {busy ? t('common.sending') : t('balance.withdraw')}
          </button>
        </form>
      ) : (
        <p className={s.hint}>
          {t('balance.minPayout', { amount: formatMoney(balance.minPayout) })}
        </p>
      )}

      {balance.payouts.length > 0 && (
        <>
          <h2>{t('balance.history')}</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                {balance.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{formatMoney(p.amount)}</strong>
                      {p.comment && (
                        <small>
                          {t('balance.reason', { reason: p.comment })}
                        </small>
                      )}
                    </td>
                    <td>{formatDate(p.createdAt)}</td>
                    <td className={s.num}>
                      <span className={`${s.badge} ${s[TONE[p.status]]}`}>
                        {t(`balance.status.${p.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className={`${s.hint} ${s.small}`}>{t('balance.perVideo')}</p>
    </div>
  );
}
