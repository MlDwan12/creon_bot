import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  decidePayout,
  fetchModPayouts,
  type ModPayout,
} from '../../api';
import { formatMoney, isWaitingLong, waitingFor } from '../../format';
import { confirmAction } from '../../telegram';
import s from './ModPayoutsView.module.css';

export default function ModPayoutsView() {
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
    fetchModPayouts().then(setItems, (err) =>
      setLoadError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не удалось загрузить заявки',
      ),
    );
  }, []);

  async function decide(p: ModPayout, decision: 'paid' | 'reject') {
    if (
      decision === 'paid' &&
      !(await confirmAction(
        `Отметить: ${formatMoney(p.amount)} переведены ${p.creator}?`,
      ))
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
      setError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не получилось, попробуйте ещё раз',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyWallet(wallet: string) {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(wallet);
    } catch {
      // буфер обмена недоступен (старый WebView) — адрес виден, его можно выделить вручную
    }
  }

  return (
    <main className={s.page}>
      <h1>Заявки на вывод</h1>
      <p className={s.hint}>
        Переведите USDT в сети TRC20 на кошелёк из заявки и отметьте её —
        креатору придёт уведомление.
      </p>

      {loadError ? (
        <p className={s.hint}>{loadError}</p>
      ) : !items ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        items.length === 0 && <p className={s.hint}>Открытых заявок нет.</p>
      )}

      {items?.map((p) => (
        <article key={p.id} className={s.item}>
          <div className={s.row}>
            <strong>{formatMoney(p.amount)}</strong>
            <span
              className={
                isWaitingLong(p.createdAt) ? `${s.wait} ${s.long}` : s.wait
              }
            >
              {waitingFor(p.createdAt)}
            </span>
          </div>
          <Link to={`/mod/creators/${p.creatorId}`} className={s.creator}>
            {p.creator} · заявка #{p.id}
          </Link>
          {p.banned && (
            <p className={s.banned} role="alert">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M5.6 5.6l12.8 12.8" />
              </svg>
              Креатор заблокирован{p.banned.reason && `: ${p.banned.reason}`}
            </p>
          )}
          {p.walletChangedHoursBefore !== null && (
            <p className={s.banned} role="alert">
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
              <label className="field-label">
                <span>Причина отказа</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Её увидит креатор"
                />
              </label>
              <div className={s.two}>
                <button
                  type="button"
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => setRejecting(undefined)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={s.reject}
                  disabled={busy || !comment.trim()}
                  onClick={() => decide(p, 'reject')}
                >
                  Отклонить
                </button>
              </div>
            </>
          ) : (
            <div className={s.two}>
              <button
                type="button"
                className={s.secondary}
                disabled={busy}
                onClick={() => setRejecting(p.id)}
              >
                Отклонить
              </button>
              <button
                type="button"
                className={s.approve}
                disabled={busy}
                onClick={() => decide(p, 'paid')}
              >
                Выплачено
              </button>
            </div>
          )}
        </article>
      ))}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
