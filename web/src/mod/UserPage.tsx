import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ACTION_LABELS,
  banUser,
  type CreatorProfile,
  errorText,
  fetchCreator,
  fetchUserHistory,
  type ModUserHistory,
  reasonLabel,
  reportObject,
  safeUrl,
  unbanUser,
} from '../api';
import { formatDate } from '../format';
import s from './mod.module.css';

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
 * Пользователь глазами модератора: профиль, блокировка и история модерации — то, что в мини-аппе
 * показывают ProfileView (блок модератора) и ModHistory.
 */
export function UserPage() {
  const id = Number(useParams().id);
  const [profile, setProfile] = useState<CreatorProfile>();
  const [history, setHistory] = useState<ModUserHistory>();
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [banning, setBanning] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        fetchCreator(id),
        fetchUserHistory(id),
      ]);
      setProfile(p);
      setHistory(h);
    } catch (err) {
      setLoadError(errorText(err, 'Не удалось загрузить профиль'));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function act(action: () => Promise<unknown>, question: string) {
    if (!window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setBanning(false);
      setBanReason('');
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className={s.hint}>{loadError}</p>;
  if (!profile || !history) return <p className={s.hint}>Загрузка…</p>;

  return (
    <div className={s.page}>
      <header>
        <p className={s.hint}>Пользователь #{profile.id}</p>
        <h1>{profile.name}</h1>
      </header>

      <div className={s.review}>
        <div className={s.page}>
          <section className={s.rows}>
            <div className={s.row}>
              <span>Рейтинг</span>
              <span>
                {profile.rating === null
                  ? 'отзывов нет'
                  : `${profile.rating.toFixed(1)} · отзывов ${profile.reviewsCount}`}
              </span>
            </div>
            <div className={s.row}>
              <span>Выполнено заказов</span>
              <span>{profile.completed}</span>
            </div>
            <div className={s.row}>
              <span>Кошелёк USDT TRC20</span>
              <span>{profile.wallet ?? '—'}</span>
            </div>
            <div className={s.row}>
              <span>Соцсети</span>
              <span>
                {profile.links.length === 0
                  ? '—'
                  : profile.links.map((url) => (
                      <span key={url}>
                        {safeUrl(url) ? (
                          <a
                            href={safeUrl(url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {url}
                          </a>
                        ) : (
                          url
                        )}
                        <br />
                      </span>
                    ))}
              </span>
            </div>
          </section>

          <section className={s.card}>
            <h2>История модерации</h2>
            {history.ban && (
              <p className={s.hint}>
                Заблокировал: {history.ban.by ?? 'неизвестно (до журнала)'}
              </p>
            )}
            {history.events.length === 0 ? (
              <p className={s.hint}>Жалоб и блокировок не было.</p>
            ) : (
              <ol>
                {history.events.map((e, i) =>
                  e.kind === 'report' ? (
                    <li key={`r${i}`}>
                      <strong>Жалоба</strong> на{' '}
                      <ObjectLink target={e.target} id={e.targetId} /> от{' '}
                      <Link to={`/mod/creators/${e.reporterId}`}>
                        {e.reporter}
                      </Link>
                      : {reasonLabel(e.target, e.reason)}
                      {e.comment && ` — «${e.comment}»`}
                      <small className={s.hint}>
                        {' '}
                        · {formatDate(e.at)} · {REPORT_STATUS[e.status]}
                      </small>
                    </li>
                  ) : (
                    <li key={`a${i}`}>
                      <strong
                        className={
                          e.type === 'USER_BAN'
                            ? s.error
                            : e.type === 'USER_UNBAN'
                              ? s.notice
                              : undefined
                        }
                      >
                        {ACTION_LABELS[e.type]}
                      </strong>
                      {e.target && (
                        <>
                          {' '}
                          · <ObjectLink target={e.target} id={e.targetId} />
                        </>
                      )}
                      {e.comment && ` — «${e.comment}»`}
                      <small className={s.hint}>
                        {' '}
                        · {formatDate(e.at)} · {e.moderator}
                      </small>
                    </li>
                  ),
                )}
              </ol>
            )}
          </section>
        </div>

        <aside className={`${s.card} ${s.decision}`}>
          {profile.ban ? (
            <>
              <p className={s.dangerNote}>
                Заблокирован {formatDate(profile.ban.at)}
                {profile.ban.reason && `: ${profile.ban.reason}`}
              </p>
              <button
                type="button"
                className={s.btn}
                disabled={busy}
                onClick={() =>
                  act(
                    () => unbanUser(profile.id),
                    'Разблокировать? Закрытые заказы не откроются сами.',
                  )
                }
              >
                Разблокировать
              </button>
            </>
          ) : banning ? (
            <>
              <label className={s.field}>
                <span>Причина блокировки</span>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Причина — пользователь её увидит"
                />
              </label>
              <div className={s.buttons}>
                <button
                  type="button"
                  className={s.btn}
                  disabled={busy}
                  onClick={() => setBanning(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.rejectSolid}`}
                  disabled={busy || !banReason.trim()}
                  onClick={() =>
                    act(
                      () => banUser(profile.id, banReason),
                      'Заблокировать? Его открытые заказы закроются, отклики без видео удалятся.',
                    )
                  }
                >
                  Заблокировать
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={`${s.btn} ${s.reject}`}
              onClick={() => setBanning(true)}
            >
              Заблокировать пользователя
            </button>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
