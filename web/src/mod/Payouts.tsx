import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  decidePayout,
  errorText,
  fetchModPayouts,
  type ModPayout,
} from '../api';
import { formatMoney, isWaitingLong, waitingFor } from '../format';
import s from '../ui.module.css';

/** Заявки на вывод — как в мини-аппе (webapp/src/views/mod/ModPayoutsView.tsx), карточками в сетку. */
export function Payouts() {
  const [items, setItems] = useState<ModPayout[]>();
  const [loadError, setLoadError] = useState('');
  /** У какой заявки открыта форма отказа. */
  const [rejecting, setRejecting] = useState<number>();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Адрес, который только что скопировали, — подпись «Скопировано». */
  const [copied, setCopied] = useState('');

  useEffect(() => {
    fetchModPayouts().then(setItems, (err: unknown) =>
      setLoadError(errorText(err, 'Не удалось загрузить заявки')),
    );
  }, []);

  async function decide(p: ModPayout, decision: 'paid' | 'reject') {
    if (
      decision === 'paid' &&
      !window.confirm(
        `Отметить: ${formatMoney(p.amount)} переведены ${p.creator}?`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await decidePayout(
        p.id,
        decision,
        decision === 'reject' ? comment : undefined,
      );
      setItems((list) => list?.filter((i) => i.id !== p.id));
      setRejecting(undefined);
      setComment('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyWallet(wallet: string) {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(wallet);
    } catch {
      // буфер обмена недоступен — адрес виден, его можно выделить вручную
    }
  }

  return (
    <div className={s.page}>
      <h1>Заявки на вывод</h1>
      <p className={s.hint}>
        Переведите USDT в сети TRC20 на кошелёк из заявки и отметьте её —
        креатору придёт уведомление.
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {loadError ? (
        <p className={s.hint}>{loadError}</p>
      ) : !items ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        items.length === 0 && <p className={s.hint}>Открытых заявок нет.</p>
      )}

      <div className={s.cards}>
        {items?.map((p) => (
          <article key={p.id} className={s.card}>
            <div className={s.cardHead}>
              <strong className={s.amount}>{formatMoney(p.amount)}</strong>
              <span
                className={
                  isWaitingLong(p.createdAt) ? `${s.wait} ${s.long}` : s.wait
                }
              >
                {waitingFor(p.createdAt)}
              </span>
            </div>
            <Link to={`/mod/creators/${p.creatorId}`}>
              {p.creator} · заявка #{p.id}
            </Link>
            {p.banned && (
              <p className={s.dangerNote} role="alert">
                Креатор заблокирован{p.banned.reason && `: ${p.banned.reason}`}
              </p>
            )}
            {p.walletChangedHoursBefore !== null && (
              <p className={s.dangerNote} role="alert">
                Кошелёк сменён{' '}
                {p.walletChangedHoursBefore < 1
                  ? 'меньше чем за час'
                  : `за ${p.walletChangedHoursBefore} ч`}{' '}
                до заявки — уточните у креатора через поддержку, что это он
              </p>
            )}
            {p.wallet ? (
              <button
                type="button"
                className={s.wallet}
                onClick={() => copyWallet(p.wallet!)}
              >
                <span>{p.wallet}</span>
                <small>
                  {copied === p.wallet ? 'Скопировано' : 'Скопировать'}
                </small>
              </button>
            ) : (
              <p className={s.hint}>
                Кошелька в заявке нет — уточните реквизиты в теме креатора.
              </p>
            )}

            {rejecting === p.id ? (
              <>
                <label className={s.field}>
                  <span>Причина отказа</span>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Её увидит креатор"
                  />
                </label>
                <div className={s.buttons}>
                  <button
                    type="button"
                    className={s.btn}
                    disabled={busy}
                    onClick={() => setRejecting(undefined)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className={`${s.btn} ${s.rejectSolid}`}
                    disabled={busy || !comment.trim()}
                    onClick={() => decide(p, 'reject')}
                  >
                    Отклонить
                  </button>
                </div>
              </>
            ) : (
              <div className={s.buttons}>
                <button
                  type="button"
                  className={`${s.btn} ${s.approve}`}
                  disabled={busy}
                  onClick={() => decide(p, 'paid')}
                >
                  Выплачено
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.reject}`}
                  disabled={busy}
                  onClick={() => {
                    setRejecting(p.id);
                    setComment('');
                  }}
                >
                  Отклонить
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
