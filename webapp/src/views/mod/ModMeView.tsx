import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  fetchModMe,
  type ModeratorActionType,
  type ModMe,
  sendModActionsCsv,
} from '../../api';
import { formatMoney, timeAgo } from '../../format';
import s from './ModMeView.module.css';

const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];

const LABELS: Record<ModeratorActionType, string> = {
  ORDER_APPROVE: 'Заказ опубликован',
  ORDER_REJECT: 'Заказ отклонён',
  VIDEO_APPROVE: 'Ролик одобрен',
  VIDEO_REJECT: 'Ролик отклонён',
  HOLD_FINALIZE: 'Итог холда',
  PUBLICATION_DELETED: 'Публикация удалена',
  REVIEW_APPROVE: 'Отзыв опубликован',
  REVIEW_REMOVE: 'Отзыв удалён',
  REPORT_ACTION: 'Жалоба: мера',
  REPORT_DISMISS: 'Жалоба: нарушений нет',
  PAYOUT_PAID: 'Выплата проведена',
  PAYOUT_REJECT: 'Выплата отклонена',
  USER_BAN: 'Блокировка',
  USER_UNBAN: 'Разблокировка',
};

const WAITS: {
  key: keyof ModMe['team'][number]['medianWaitSec'];
  label: string;
}[] = [
  { key: 'orders', label: 'Заказы' },
  { key: 'videos', label: 'Ролики' },
  { key: 'holds', label: 'Итоги холда (с конца холда)' },
  { key: 'reports', label: 'Жалобы' },
  { key: 'payouts', label: 'Выплаты' },
];

/** «12 мин», «3,5 ч», «2 дн». */
function formatWait(sec: number | null) {
  if (sec === null) return '—';
  const min = sec / 60;
  if (min < 60) return `${Math.max(1, Math.round(min))} мин`;
  if (min < 48 * 60)
    return `${(min / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
  return `${Math.round(min / 60 / 24)} дн`;
}

/** Куда ведёт действие в журнале; у выплат своего экрана нет. */
function linkOf(a: ModMe['recent'][number]): string | null {
  const t = a.type;
  if (t.startsWith('ORDER_')) return `/mod/orders/${a.objectId}`;
  if (t.startsWith('USER_')) return `/mod/creators/${a.objectId}`;
  if (t.startsWith('REPORT_'))
    return a.reportTarget === 'ORDER'
      ? `/mod/orders/${a.objectId}`
      : a.reportTarget === 'PROFILE'
        ? `/mod/creators/${a.objectId}`
        : `/mod/videos/${a.objectId}`;
  if (t.startsWith('PAYOUT_')) return null;
  return `/mod/videos/${a.objectId}`;
}

/** Сумма по двум типам — плитки «опубликовано / отклонено». */
const pair = (
  c: Record<ModeratorActionType, number>,
  a: ModeratorActionType,
  b: ModeratorActionType,
) => `${c[a]} / ${c[b]}`;

export default function ModMeView() {
  const [period, setPeriod] = useState<number | undefined>(30);
  const [data, setData] = useState<ModMe>();
  const [error, setError] = useState('');
  const [csvState, setCsvState] = useState<{
    scope: 'me' | 'team';
    sending: boolean;
    error: string;
  }>();
  const lastRequest = useRef(0);

  // Быстро переключили период — применяем только ответ на последний запрос.
  useEffect(() => {
    const requestId = ++lastRequest.current;
    setError('');
    fetchModMe(period).then(
      (d) => requestId === lastRequest.current && setData(d),
      () =>
        requestId === lastRequest.current &&
        setError('Не удалось загрузить кабинет'),
    );
  }, [period]);

  async function sendCsv(scope: 'me' | 'team') {
    setCsvState({ scope, sending: true, error: '' });
    try {
      await sendModActionsCsv(period, scope);
      setCsvState({ scope, sending: false, error: '' });
    } catch (err) {
      setCsvState({
        scope,
        sending: false,
        error:
          err instanceof ApiError
            ? err.userMessage
            : 'Не получилось, попробуйте ещё раз',
      });
    }
  }

  const me = data?.team.find((m) => m.moderatorId === data.moderatorId);
  const flushTitle = `section-title ${s.flush}`;

  return (
    <main className={s.page}>
      <h1>Мой кабинет</h1>
      {me && <p className={s.hint}>{me.label}</p>}

      <div className={s.segmented} role="tablist" aria-label="Период">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            role="tab"
            aria-selected={period === p.days}
            onClick={() => setPeriod(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className={s.hint}>{error}</p>
      ) : !data || !me ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        <>
          <h2 className={flushTitle}>Мои решения</h2>
          <div className={s.tiles}>
            <div className={s.tile}>
              <strong>
                {pair(me.counts, 'ORDER_APPROVE', 'ORDER_REJECT')}
              </strong>
              <span>заказов опубликовано / отклонено</span>
            </div>
            <div className={s.tile}>
              <strong>
                {pair(me.counts, 'VIDEO_APPROVE', 'VIDEO_REJECT')}
              </strong>
              <span>роликов одобрено / отклонено</span>
            </div>
            <div className={s.tile}>
              <strong>
                {pair(me.counts, 'HOLD_FINALIZE', 'PUBLICATION_DELETED')}
              </strong>
              <span>итогов холда / публикаций удалено</span>
            </div>
            <div className={s.tile}>
              <strong>
                {pair(me.counts, 'REVIEW_APPROVE', 'REVIEW_REMOVE')}
              </strong>
              <span>отзывов опубликовано / удалено</span>
            </div>
            <div className={s.tile}>
              <strong>
                {pair(me.counts, 'REPORT_ACTION', 'REPORT_DISMISS')}
              </strong>
              <span>жалоб: мера / нарушений нет</span>
            </div>
            <div className={s.tile}>
              <strong>{pair(me.counts, 'USER_BAN', 'USER_UNBAN')}</strong>
              <span>блокировок / снято</span>
            </div>
            <div className={s.tile}>
              <strong>{pair(me.counts, 'PAYOUT_PAID', 'PAYOUT_REJECT')}</strong>
              <span>выплат проведено / отклонено</span>
            </div>
            <div className={s.tile}>
              <strong>{formatMoney(me.paid)}</strong>
              <span>выплачено креаторам</span>
            </div>
          </div>

          <h2 className={flushTitle}>Сколько ждали моего решения · медиана</h2>
          <ol className={s.rows}>
            {WAITS.map((w) => (
              <li key={w.key}>
                <span>{w.label}</span>
                <strong>{formatWait(me.medianWaitSec[w.key])}</strong>
              </li>
            ))}
          </ol>

          <h2 className={flushTitle}>Выгрузка CSV в чат с ботом</h2>
          <div className={s.actions}>
            <button
              type="button"
              disabled={csvState?.sending}
              onClick={() => sendCsv('me')}
            >
              Мои действия
            </button>
            <button
              type="button"
              disabled={csvState?.sending}
              onClick={() => sendCsv('team')}
            >
              Вся команда
            </button>
          </div>
          {csvState && !csvState.sending && !csvState.error && (
            <p className={s.notice} role="status">
              Файл отправлен в чат с ботом
            </p>
          )}
          {csvState?.error && (
            <p className={s.error} role="alert">
              {csvState.error}
            </p>
          )}

          <h2 className={flushTitle}>Команда</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th></th>
                <th>Заказы</th>
                <th>Ролики</th>
                <th>Жалобы</th>
                <th>Выплаты</th>
              </tr>
            </thead>
            <tbody>
              {data.team.map((m) => {
                const c = m.counts;
                return (
                  <tr
                    key={m.moderatorId}
                    className={m === me ? s.mine : undefined}
                  >
                    <th scope="row">{m.label}</th>
                    <td>{c.ORDER_APPROVE + c.ORDER_REJECT}</td>
                    <td>
                      {c.VIDEO_APPROVE +
                        c.VIDEO_REJECT +
                        c.HOLD_FINALIZE +
                        c.PUBLICATION_DELETED}
                    </td>
                    <td>{c.REPORT_ACTION + c.REPORT_DISMISS}</td>
                    <td>{c.PAYOUT_PAID + c.PAYOUT_REJECT}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={`${s.hint} ${s.small}`}>
            Ролики — проверка и итоги холда. Жалобы — решения по объекту, а не
            по каждой жалобе.
          </p>

          <h2 className={flushTitle}>Мои последние действия</h2>
          {data.recent.length === 0 ? (
            <p className={s.hint}>Действий пока нет.</p>
          ) : (
            <ol className={`${s.rows} ${s.recent}`}>
              {data.recent.map((a) => {
                const to = linkOf(a);
                const what = `${LABELS[a.type]} #${a.objectId}${a.amount !== null ? ` · ${formatMoney(a.amount)}` : ''}`;
                return (
                  <li key={a.id}>
                    {to ? <Link to={to}>{what}</Link> : <span>{what}</span>}
                    <small>{timeAgo(a.createdAt)}</small>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </main>
  );
}
