import { useState } from 'react';
import { Link } from 'react-router';
import {
  ACTION_LABELS,
  errorText,
  fetchModMe,
  type ModeratorActionType,
  type ModMe,
  sendModActionsCsv,
} from '../api';
import { formatMoney, timeAgo } from '../format';
import s from './mod.module.css';
import { Period } from './Period';
import { useLatest } from './useLatest';

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

const TILES: [ModeratorActionType, ModeratorActionType, string][] = [
  ['ORDER_APPROVE', 'ORDER_REJECT', 'заказов опубликовано / отклонено'],
  ['VIDEO_APPROVE', 'VIDEO_REJECT', 'роликов одобрено / отклонено'],
  ['HOLD_FINALIZE', 'PUBLICATION_DELETED', 'итогов холда / публикаций удалено'],
  ['REVIEW_APPROVE', 'REVIEW_REMOVE', 'отзывов опубликовано / удалено'],
  ['REPORT_ACTION', 'REPORT_DISMISS', 'жалоб: мера / нарушений нет'],
  ['USER_BAN', 'USER_UNBAN', 'блокировок / снято'],
  ['PAYOUT_PAID', 'PAYOUT_REJECT', 'выплат проведено / отклонено'],
];

/** «Я» — кабинет модератора, как в мини-аппе (webapp/src/views/mod/ModMeView.tsx). */
export function MyCabinet() {
  const [period, setPeriod] = useState<number | undefined>(30);
  const { data, error } = useLatest(fetchModMe, period);
  const [csv, setCsv] = useState<{ sending: boolean; error: string }>();

  async function sendCsv(scope: 'me' | 'team') {
    setCsv({ sending: true, error: '' });
    try {
      await sendModActionsCsv(period, scope);
      setCsv({ sending: false, error: '' });
    } catch (err) {
      setCsv({ sending: false, error: errorText(err) });
    }
  }

  const me = data?.team.find((m) => m.moderatorId === data.moderatorId);

  return (
    <div className={s.page}>
      <h1>Мой кабинет</h1>
      {me && <p className={s.hint}>{me.label}</p>}
      <Period value={period} onChange={setPeriod} />

      {error ? (
        <p className={s.hint}>Не удалось загрузить кабинет</p>
      ) : !data || !me ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        <>
          <h2>Мои решения</h2>
          <div className={s.tiles}>
            {TILES.map(([a, b, label]) => (
              <div key={a} className={s.tile}>
                <strong>{pair(me.counts, a, b)}</strong>
                <span>{label}</span>
              </div>
            ))}
            <div className={s.tile}>
              <strong>{formatMoney(me.paid)}</strong>
              <span>выплачено креаторам</span>
            </div>
          </div>

          <h2>Сколько ждали моего решения · медиана</h2>
          <ol className={s.rows}>
            {WAITS.map((w) => (
              <li key={w.key} className={s.row}>
                <span>{w.label}</span>
                <span>{formatWait(me.medianWaitSec[w.key])}</span>
              </li>
            ))}
          </ol>

          <h2>Выгрузка CSV в чат с ботом</h2>
          <div className={s.buttons}>
            <button
              type="button"
              className={s.btn}
              disabled={csv?.sending}
              onClick={() => sendCsv('me')}
            >
              Мои действия
            </button>
            <button
              type="button"
              className={s.btn}
              disabled={csv?.sending}
              onClick={() => sendCsv('team')}
            >
              Вся команда
            </button>
          </div>
          {csv && !csv.sending && !csv.error && (
            <p className={s.notice} role="status">
              Файл отправлен в чат с ботом
            </p>
          )}
          {csv?.error && (
            <p className={s.error} role="alert">
              {csv.error}
            </p>
          )}

          <h2>Команда</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th></th>
                  <th className={s.num}>Заказы</th>
                  <th className={s.num}>Ролики</th>
                  <th className={s.num}>Жалобы</th>
                  <th className={s.num}>Выплаты</th>
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
                      <td className={s.num}>
                        {c.ORDER_APPROVE + c.ORDER_REJECT}
                      </td>
                      <td className={s.num}>
                        {c.VIDEO_APPROVE +
                          c.VIDEO_REJECT +
                          c.HOLD_FINALIZE +
                          c.PUBLICATION_DELETED}
                      </td>
                      <td className={s.num}>
                        {c.REPORT_ACTION + c.REPORT_DISMISS}
                      </td>
                      <td className={s.num}>
                        {c.PAYOUT_PAID + c.PAYOUT_REJECT}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={`${s.hint} ${s.small}`}>
            Ролики — проверка и итоги холда. Жалобы — решения по объекту, а не
            по каждой жалобе.
          </p>

          <h2>Мои последние действия</h2>
          {data.recent.length === 0 ? (
            <p className={s.hint}>Действий пока нет.</p>
          ) : (
            <ol className={s.rows}>
              {data.recent.map((a) => {
                const to = linkOf(a);
                const what = `${ACTION_LABELS[a.type]} #${a.objectId}${a.amount !== null ? ` · ${formatMoney(a.amount)}` : ''}`;
                return (
                  <li key={a.id} className={s.row}>
                    {to ? <Link to={to}>{what}</Link> : <span>{what}</span>}
                    <span className={s.muted}>{timeAgo(a.createdAt)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
