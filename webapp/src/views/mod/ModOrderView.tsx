import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ApiError,
  categoryLabel,
  fetchModOrder,
  fetchModQueue,
  type ModOrder,
  moderateOrder,
  type OrderSummary,
} from '../../api';
import OrderCard from '../../components/OrderCard';
import ReasonPicker from '../../components/ReasonPicker';
import {
  formatCpm,
  formatDate,
  formatMoney,
  formatVideoFormat,
  formatViews,
  waitingFor,
} from '../../format';
import { safeUrl } from '../../telegram';
import s from './ModOrderView.module.css';

const PRESETS = [
  'Нечёткое задание — опишите, что именно снять',
  'Контакты в описании — общение идёт через бота',
  'Запрещённая тематика',
  'Некорректный бюджет',
];
const STATUS_LABELS: Record<ModOrder['status'], string> = {
  PENDING_MODERATION: 'На проверке',
  OPEN: 'Опубликован',
  REJECTED: 'Отклонён',
  CLOSED: 'Закрыт',
  EXPIRED: 'Срок вышел',
  EDIT_REJECTED: 'Правки отклонены',
};
/** Частые ставки, USDT за 1000 просмотров; другая — в поле ниже. */
const CPM_PRESETS = [1, 1.5, 2, 3];

const warnIcon = (
  <svg
    className={s.icon}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);

/** Ссылка от пользователя: кликабельная, только если http(s). */
const userLink = (url: string) =>
  safeUrl(url) ? (
    <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  ) : (
    url
  );

export default function ModOrderView() {
  const id = Number(useParams().id);
  const navigate = useNavigate();

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

  // экран пересоздаётся на каждый заказ (ключ по адресу в App.tsx) — загружаем один раз
  const load = useCallback(async () => {
    try {
      const o = await fetchModOrder(id);
      setOrder(o);
      setCpm(o.cpm === null ? '' : String(o.cpm));
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не удалось загрузить заказ',
      );
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (loadError)
    return (
      <main className={s.page}>
        <p className={s.hint}>{loadError}</p>
      </main>
    );
  if (!order)
    return (
      <main className={s.page}>
        <p className={s.hint}>Загрузка…</p>
      </main>
    );

  const cpmNum = Number(cpm);
  /** Бюджет выше одобренного в прошлый раз — опубликовать можно, только отметив, что доплата получена. */
  const budgetRaised =
    order.approvedBudget !== null && order.budget > order.approvedBudget;
  /** Сколько просмотров оплатит фонд при этой ставке — чтобы ставка была разумной. */
  const coveredViews = cpmNum ? Math.floor((order.pool / cpmNum) * 1000) : 0;
  /** Карточка в каталоге с выбранной ставкой — как её увидят креаторы после публикации. */
  const previewCard: OrderSummary = {
    ...order,
    cpm: cpmNum || null,
    // как отдаёт API креаторам (freeForCreators): вниз до 100 USDT
    free: Math.floor(order.pool / 100) * 100,
    freeUnder: order.pool < 100 ? 100 : null,
    budgetLow: false,
  };

  /** После решения — сразу следующий заказ из очереди; очередь пуста — назад к ней. */
  async function goNext() {
    const next = (await fetchModQueue().catch(() => undefined))?.orders.find(
      (o) => o.id !== id,
    );
    await navigate(next ? `/mod/orders/${next.id}` : '/mod', { replace: true });
  }

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
      await goNext();
    } catch (err) {
      // Например, другой модератор успел раньше: «Этот заказ уже обработан».
      setError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не получилось, попробуйте ещё раз',
      );
    } finally {
      setBusy(false);
    }
  }

  const pending = order.status === 'PENDING_MODERATION';
  const videoFormat = formatVideoFormat(order);

  return (
    <main className={s.page}>
      <header className={s.head}>
        <span className={pending ? `${s.badge} ${s.pending}` : s.badge}>
          Заказ #{order.id} · {STATUS_LABELS[order.status]}
          {pending && ` · ждёт ${waitingFor(order.version)}`}
        </span>
        <h1>{order.title}</h1>
      </header>

      {/* контакты — первым: из-за них заказ чаще всего отклоняют */}
      {order.contacts.length > 0 && (
        <div className={s.contacts} role="alert">
          <strong>
            {warnIcon} Похоже на контакты для связи в обход площадки
          </strong>
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
      </section>

      <div className={s.text}>{order.description}</div>
      {videoFormat && <p className={s.reference}>Ролик: {videoFormat}</p>}
      {order.referenceUrl && (
        <p className={s.reference}>Референс: {userLink(order.referenceUrl)}</p>
      )}
      {order.targetUrl && (
        <p className={s.reference}>Товар: {userLink(order.targetUrl)}</p>
      )}

      {budgetRaised && pending && (
        <label className={s.contacts} role="alert">
          <strong>
            {warnIcon} Бюджет повышен на{' '}
            {formatMoney(order.budget - order.approvedBudget!)}
          </strong>
          <span>
            <input
              type="checkbox"
              checked={paymentConfirmed}
              onChange={(e) => setPaymentConfirmed(e.target.checked)}
            />{' '}
            Доплата получена
          </span>
        </label>
      )}

      {order.moderatorComment && (
        <p className={s.hint}>
          Комментарий модератора: «{order.moderatorComment}»
        </p>
      )}

      {pending && (
        <>
          <div className={s.cpm}>
            <span id="cpm-label" className="section-title">
              Ставка креатору за 1000 просмотров, USDT
            </span>
            <div
              className={s.presets}
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
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="Другая ставка"
              aria-labelledby="cpm-label"
            />
            {coveredViews > 0 && (
              <span className={s.hint}>
                Фонда хватит примерно на {formatViews(coveredViews)} просмотров
              </span>
            )}
          </div>

          {cpmNum > 0 && (
            <section className={s.block}>
              <h2 className="section-title">Так увидят креаторы</h2>
              <OrderCard order={previewCard} preview />
            </section>
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
            <div className={`bottom-bar ${s.two}`}>
              <button
                type="button"
                className={s.secondary}
                disabled={busy}
                onClick={() => setRejecting(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className={s.rejectConfirm}
                disabled={busy || !comment.trim()}
                onClick={() => decide('reject')}
              >
                Отклонить
              </button>
            </div>
          ) : (
            <div className={`bottom-bar ${s.two}`}>
              <button
                type="button"
                className={s.reject}
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                Отклонить
              </button>
              <button
                type="button"
                className={s.approve}
                disabled={
                  busy || !cpmNum || (budgetRaised && !paymentConfirmed)
                }
                onClick={() => decide('approve')}
              >
                Опубликовать
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
