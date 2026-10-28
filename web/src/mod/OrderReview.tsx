import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  categoryLabel,
  errorText,
  fetchModOrder,
  type ModOrder,
  moderateOrder,
  safeUrl,
} from '../api';
import {
  formatCpm,
  formatDate,
  formatMoney,
  formatVideoFormat,
  formatViews,
  waitingFor,
} from '../format';
import s from './mod.module.css';
import { ReasonPicker } from './ReasonPicker';

const PRESETS = [
  'Нечёткое задание — опишите, что именно снять',
  'Контакты в описании — общение идёт через бота',
  'Запрещённая тематика',
  'Некорректный бюджет',
];
export const ORDER_STATUS: Record<
  ModOrder['status'],
  { label: string; tone: 'success' | 'warn' | 'danger' | 'muted' }
> = {
  PENDING_MODERATION: { label: 'На проверке', tone: 'warn' },
  OPEN: { label: 'Опубликован', tone: 'success' },
  REJECTED: { label: 'Отклонён', tone: 'danger' },
  CLOSED: { label: 'Закрыт', tone: 'muted' },
  EXPIRED: { label: 'Срок вышел', tone: 'muted' },
  EDIT_REJECTED: { label: 'Правки отклонены', tone: 'danger' },
};
/** Частые ставки, USDT за 1000 просмотров; другая — в поле ниже. */
const CPM_PRESETS = [1, 1.5, 2, 3];

/** Ссылка от пользователя: кликабельная, только если http(s). */
const userLink = (url: string) =>
  safeUrl(url) ? (
    <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  ) : (
    url
  );

/**
 * Проверка заказа — то же, что в мини-аппе (webapp/src/views/mod/ModOrderView.tsx), в две колонки:
 * слева заказ, справа ставка и решение. `onDone` — решение принято.
 */
export function OrderReview({
  id,
  onDone,
}: {
  id: number;
  onDone: () => void;
}) {
  const [order, setOrder] = useState<ModOrder>();
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Ставка креатору за 1000 просмотров, USDT; '' — ещё не введена. После правки — прежняя. */
  const [cpm, setCpm] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  /** Отказ в два шага: сначала «Отклонить», потом причина и подтверждение. */
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await fetchModOrder(id);
      setOrder(o);
      setCpm(o.cpm === null ? '' : String(o.cpm));
    } catch (err) {
      setLoadError(errorText(err, 'Не удалось загрузить заказ'));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (loadError) return <p className={s.hint}>{loadError}</p>;
  if (!order) return <p className={s.hint}>Загрузка…</p>;

  const cpmNum = Number(cpm);
  /** Бюджет выше одобренного в прошлый раз — опубликовать можно, только отметив, что доплата получена. */
  const budgetRaised =
    order.approvedBudget !== null && order.budget > order.approvedBudget;
  /** Сколько просмотров оплатит фонд при этой ставке — чтобы ставка была разумной. */
  const coveredViews = cpmNum ? Math.floor((order.pool / cpmNum) * 1000) : 0;

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError('');
    try {
      await moderateOrder(
        id,
        decision,
        order!.version,
        decision === 'reject'
          ? { comment }
          : {
              cpm: cpmNum,
              ...(budgetRaised && { budgetConfirmed: order!.budget }),
            },
      );
      onDone();
    } catch (err) {
      // например, другой модератор успел раньше: «Этот заказ уже обработан»
      setError(errorText(err));
      setBusy(false);
    }
  }

  const pending = order.status === 'PENDING_MODERATION';
  const status = ORDER_STATUS[order.status];
  const videoFormat = formatVideoFormat(order);

  return (
    <div className={s.page}>
      <header>
        <p className={s.hint}>
          <span className={`${s.badge} ${s[status.tone]}`}>{status.label}</span>{' '}
          Заказ #{order.id}
          {pending && ` · ждёт ${waitingFor(order.version)}`}
        </p>
        <h1>{order.title}</h1>
      </header>

      <div className={s.review}>
        <div className={s.page}>
          {/* контакты — первым: из-за них заказ чаще всего отклоняют */}
          {order.contacts.length > 0 && (
            <div className={s.alert} role="alert">
              <strong>Похоже на контакты для связи в обход площадки</strong>
              <span>{order.contacts.join(' · ')}</span>
            </div>
          )}

          <section className={s.rows}>
            <div className={s.row}>
              <span>Рекламодатель</span>
              <span>{order.advertiser}</span>
            </div>
            <div className={s.row}>
              <span>Бюджет</span>
              <span>
                {budgetRaised && `${formatMoney(order.approvedBudget!)} → `}
                {formatMoney(order.budget)}, креаторам {formatMoney(order.pool)}{' '}
                (комиссия {order.feePercent}%)
              </span>
            </div>
            <div className={s.row}>
              <span>Порог</span>
              <span>от {formatViews(order.minViews)} просмотров</span>
            </div>
            {order.cpm !== null && (
              <div className={s.row}>
                <span>Ставка</span>
                <span>{formatCpm(order.cpm)}</span>
              </div>
            )}
            {order.deadline && (
              <div className={s.row}>
                <span>Срок</span>
                <span>до {formatDate(order.deadline)}</span>
              </div>
            )}
            <div className={s.row}>
              <span>Категория</span>
              <span>{categoryLabel(order.category)}</span>
            </div>
            {videoFormat && (
              <div className={s.row}>
                <span>Ролик</span>
                <span>{videoFormat}</span>
              </div>
            )}
          </section>

          <section className={s.card}>
            <h2>Задание</h2>
            <div className={s.text}>{order.description}</div>
            {order.exampleUrls.length > 0 && (
              <div>
                <p className={s.hint}>
                  Примеры роликов — креаторы видят их без ника автора;
                  проверьте, что это ролики по теме, а не аккаунт заказчика:
                </p>
                <ol>
                  {order.exampleUrls.map((url) => (
                    <li key={url}>{userLink(url)}</li>
                  ))}
                </ol>
              </div>
            )}
            {order.referenceUrl && <p>Бриф: {userLink(order.referenceUrl)}</p>}
            {order.targetUrl && (
              <p>
                Товар: {userLink(order.targetUrl)}
                {order.linkInBio &&
                  ' · креатор держит ссылку и в шапке профиля'}
              </p>
            )}
          </section>

          {order.moderatorComment && (
            <p className={s.hint}>
              Комментарий модератора: «{order.moderatorComment}»
            </p>
          )}
        </div>

        {pending && (
          <aside className={`${s.card} ${s.decision}`}>
            <div className={s.field}>
              <span id="cpm-label">
                Ставка креатору за 1000 просмотров, USDT
              </span>
              <div
                className={s.chips}
                role="radiogroup"
                aria-labelledby="cpm-label"
              >
                {CPM_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={cpm !== '' && cpmNum === v}
                    onClick={() => setCpm(String(v))}
                  >
                    {v.toLocaleString('ru-RU')}
                  </button>
                ))}
              </div>
              <input
                value={cpm}
                onChange={(e) => setCpm(e.target.value)}
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Другая ставка"
                aria-labelledby="cpm-label"
              />
            </div>
            {coveredViews > 0 && (
              <p className={`${s.hint} ${s.small}`}>
                Фонда хватит примерно на {formatViews(coveredViews)} просмотров
              </p>
            )}

            {budgetRaised && (
              <label className={s.alert}>
                <strong>
                  Бюджет повышен на{' '}
                  {formatMoney(order.budget - order.approvedBudget!)}
                </strong>
                <span className={s.check}>
                  <input
                    type="checkbox"
                    checked={paymentConfirmed}
                    onChange={(e) => setPaymentConfirmed(e.target.checked)}
                  />
                  Доплата получена
                </span>
              </label>
            )}

            {rejecting && (
              <ReasonPicker
                value={comment}
                onChange={setComment}
                presets={PRESETS}
              />
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {rejecting ? (
              <div className={s.buttons}>
                <button
                  type="button"
                  className={s.btn}
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.rejectSolid}`}
                  disabled={busy || !comment.trim()}
                  onClick={() => decide('reject')}
                >
                  Отклонить
                </button>
              </div>
            ) : (
              <div className={s.buttons}>
                <button
                  type="button"
                  className={`${s.btn} ${s.approve}`}
                  disabled={
                    busy || !cpmNum || (budgetRaised && !paymentConfirmed)
                  }
                  onClick={() => decide('approve')}
                >
                  Опубликовать
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.reject}`}
                  disabled={busy}
                  onClick={() => setRejecting(true)}
                >
                  Отклонить
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Заказ по отдельному адресу (из списка заказов, журнала, истории); после решения — в очередь. */
export function OrderPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  return (
    <OrderReview
      key={id}
      id={id}
      onDone={() => void navigate('/mod?tab=orders', { replace: true })}
    />
  );
}
