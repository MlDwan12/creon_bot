import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchUserHistory, type ModUserHistory, reasonLabel } from '../api';
import { formatDate } from '../format';
import { ACTION_LABELS, reportObject } from '@fixum/shared';
import s from './ModHistory.module.css';

const REPORT_STATUS: Record<'OPEN' | 'ACTIONED' | 'DISMISSED', string> = {
  OPEN: 'ждёт решения',
  ACTIONED: 'приняли меры',
  DISMISSED: 'нарушений нет',
};

/** Объект словами — ссылкой, если у него есть экран в окне модератора. */
function ObjectLink({
  target,
  id,
}: {
  target: Parameters<typeof reportObject>[0];
  id: number;
}) {
  const o = reportObject(target, id);
  return o.to ? <Link to={o.to}>{o.text}</Link> : <>{o.text}</>;
}

/**
 * История модерации пользователя в его профиле (окно модератора): кто и за что заблокировал,
 * жалобы на него и решения по ним, блокировки и разблокировки — новые сверху.
 * `version` меняется после бана или разбана — история перечитывается.
 */
export default function ModHistory({
  userId,
  version,
}: {
  userId: number;
  version: string;
}) {
  const [history, setHistory] = useState<ModUserHistory>();
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUserHistory(userId).then(setHistory, () =>
      setError('Не удалось загрузить историю'),
    );
  }, [userId, version]);

  if (error) return <p className={s.hint}>{error}</p>;
  if (!history) return null;
  return (
    <section className={s.block}>
      {history.ban && (
        <p className={s.by}>
          Заблокировал: {history.ban.by ?? 'неизвестно (до журнала)'}
        </p>
      )}
      <h2 className="section-title">История модерации</h2>
      {history.events.length === 0 ? (
        <p className={s.hint}>Жалоб и блокировок не было.</p>
      ) : (
        <ol className={s.list}>
          {history.events.map((e, i) =>
            e.kind === 'report' ? (
              <li key={`r${i}`}>
                <span>
                  <strong>Жалоба</strong> на{' '}
                  <ObjectLink target={e.target} id={e.targetId} /> от{' '}
                  <Link to={`/mod/creators/${e.reporterId}`}>{e.reporter}</Link>
                  : {reasonLabel(e.target, e.reason)}
                  {e.comment && ` — «${e.comment}»`}
                </span>
                <small>
                  {formatDate(e.at)} · {REPORT_STATUS[e.status]}
                </small>
              </li>
            ) : (
              <li
                key={`a${i}`}
                className={
                  e.type === 'USER_BAN'
                    ? s.ban
                    : e.type === 'USER_UNBAN'
                      ? s.unban
                      : undefined
                }
              >
                <span>
                  <strong>{ACTION_LABELS[e.type]}</strong>
                  {e.target && (
                    <>
                      {' '}
                      · <ObjectLink target={e.target} id={e.targetId} />
                    </>
                  )}
                  {e.comment && ` — «${e.comment}»`}
                </span>
                <small>
                  {formatDate(e.at)} · {e.moderator}
                </small>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}
