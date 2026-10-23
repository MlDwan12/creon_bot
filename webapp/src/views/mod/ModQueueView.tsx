import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ApiError,
  approveReview,
  fetchModQueue,
  fetchModReports,
  type ModQueue,
  type ModReportGroup,
  reasonLabel,
  removeReview,
  type ReportTarget,
  resolveReports,
} from '../../api';
import SupportLink from '../../components/SupportLink';
import { formatMoney, isWaitingLong, timeAgo, waitingFor } from '../../format';
import { confirmAction } from '../../telegram';
import s from './ModQueueView.module.css';

type Tab = 'orders' | 'videos' | 'holds' | 'reviews' | 'reports';
const TABS: Tab[] = ['orders', 'videos', 'holds', 'reviews', 'reports'];
const TAB_LIST: { id: Tab; label: string }[] = [
  { id: 'videos', label: 'Видео' },
  { id: 'orders', label: 'Заказы' },
  { id: 'holds', label: 'Итоги' },
  { id: 'reviews', label: 'Отзывы' },
  { id: 'reports', label: 'Жалобы' },
];

/** Мера по жалобам — своя для каждого типа объекта (см. ReportsService.resolve). */
const ACTIONS: Record<ReportTarget, { label: string; confirm: string }> = {
  ORDER: {
    label: 'Закрыть заказ',
    confirm: 'Закрыть заказ? Рекламодатель и креаторы получат уведомление.',
  },
  VIDEO: {
    label: 'Убрать из портфолио',
    confirm: 'Убрать видео из портфолио креатора?',
  },
  REVIEW: {
    label: 'Удалить отзыв',
    confirm: 'Удалить отзыв? Оценка пропадёт из рейтинга.',
  },
  PROFILE: {
    label: 'Стереть ссылки',
    confirm: 'Стереть ссылки на соцсети в профиле?',
  },
};
const TARGET_NAMES: Record<ReportTarget, string> = {
  ORDER: 'Заказ',
  VIDEO: 'Видео',
  REVIEW: 'Отзыв',
  PROFILE: 'Профиль',
};
const keyOf = (g: ModReportGroup) => `${g.target}:${g.targetId}`;

/** Куда вести модератора, чтобы посмотреть объект жалобы целиком. */
function subjectLink(g: ModReportGroup): string | null {
  if (!g.subject) return null;
  if (g.target === 'VIDEO') return `/mod/videos/${g.targetId}`;
  if (g.target === 'ORDER') return `/mod/orders/${g.targetId}`;
  return g.subject.profileId ? `/mod/creators/${g.subject.profileId}` : null;
}

/** Значок «похоже на контакты в обход площадки». */
const contactsFlag = (
  <span className={s.flag} title="Похоже на контакты в обход площадки">
    <svg
      className={s.flagIcon}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>{' '}
  </span>
);

export default function ModQueueView() {
  const [query, setQuery] = useSearchParams();
  const [queue, setQueue] = useState<ModQueue>();
  const [reports, setReports] = useState<ModReportGroup[]>([]);
  const [error, setError] = useState('');
  const [reportError, setReportError] = useState('');
  const [reviewError, setReviewError] = useState('');
  /** Карточка, в которой открыта форма блокировки автора, и причина. */
  const [banningKey, setBanningKey] = useState('');
  const [banReason, setBanReason] = useState('');

  useEffect(() => {
    Promise.all([fetchModQueue(), fetchModReports()]).then(
      ([q, r]) => {
        setQueue(q);
        setReports(r);
      },
      () => setError('Не удалось загрузить очередь'),
    );
  }, []);

  /** Сколько ждёт в каждой вкладке — на чипах; всего — в строке сверху. */
  const counts: Record<Tab, number> = {
    orders: queue?.orders.length ?? 0,
    videos: queue?.videos.length ?? 0,
    holds: queue?.holds.length ?? 0,
    reviews: queue?.reviews.length ?? 0,
    reports: reports.length,
  };
  const total = TABS.reduce((sum, t) => sum + counts[t], 0);
  // Вкладка — в адресе (?tab=videos), чтобы «Назад» из карточки вернул на ту же вкладку.
  // Без неё — первая, где что-то ждёт: модератор сразу видит работу, а не пустой список.
  const queryTab = query.get('tab') as Tab;
  const tab: Tab = TABS.includes(queryTab)
    ? queryTab
    : (TAB_LIST.find((t) => counts[t.id])?.id ?? 'videos');
  // вкладка по умолчанию зависит от очереди — выбранную пишем в адрес всегда
  const setTab = (t: Tab) => setQuery({ tab: t }, { replace: true });

  function startBan(g: ModReportGroup) {
    setBanningKey(keyOf(g));
    setBanReason(reasonLabel(g.target, g.reports[0].reason));
  }

  async function resolve(
    group: ModReportGroup,
    actioned: boolean,
    banReasonText?: string,
  ) {
    const question = banReasonText
      ? `${ACTIONS[group.target].confirm}\nИ заблокировать автора — ${group.subject?.author}?`
      : actioned
        ? ACTIONS[group.target].confirm
        : 'Нарушений нет? Жалобы закроются, авторам придёт ответ.';
    if (!(await confirmAction(question))) return;
    setReportError('');
    setBanningKey('');
    try {
      await resolveReports(
        group.target,
        group.targetId,
        actioned,
        banReasonText,
      );
    } catch (err) {
      setReportError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не получилось, попробуйте ещё раз',
      );
    }
    fetchModReports().then(setReports, () => {});
  }

  /** Отзыв с проверки: опубликовать в профиле креатора или удалить (оценка пропадёт вместе с текстом). */
  async function decideReview(submissionId: number, publish: boolean) {
    if (
      !publish &&
      !(await confirmAction('Удалить отзыв? Оценка тоже не попадёт в рейтинг.'))
    )
      return;
    setReviewError('');
    try {
      await (publish
        ? approveReview(submissionId)
        : removeReview(submissionId));
    } catch (err) {
      setReviewError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не получилось, попробуйте ещё раз',
      );
    }
    fetchModQueue().then(setQueue, () => {});
  }

  /** Самое старое ожидание в обеих очередях — главный сигнал «пора разбирать». */
  const oldest = [
    ...(queue?.orders.map((o) => o.queuedAt) ?? []),
    ...(queue?.videos
      .map((v) => v.submittedAt)
      .filter((d): d is string => !!d) ?? []),
    ...(queue?.reviews.map((r) => r.queuedAt) ?? []),
  ].sort()[0];

  const waitClass = (iso: string) =>
    isWaitingLong(iso) ? `${s.wait} ${s.long}` : s.wait;

  return (
    <main className={s.page}>
      <h1>Очередь</h1>

      {error ? (
        <p className={s.hint}>{error}</p>
      ) : !queue ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        <>
          <p className={s.summary}>
            {total ? `${total} ждут решения` : 'Всё разобрано'}
            {oldest && (
              <>
                {' · '}
                <span className={isWaitingLong(oldest) ? s.long : undefined}>
                  самое старое — {waitingFor(oldest)}
                </span>
              </>
            )}
          </p>
          {/* вкладки — чипами с прокруткой: пять подписей со счётчиками в ряд не помещаются */}
          <div className={s.chips} role="tablist" aria-label="Очередь">
            {TAB_LIST.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className={counts[t.id] ? undefined : s.empty}
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <span className={s.count}>{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <p className={s.hint}>
            Сначала самые старые. Оранжевым — ждут дольше 4 часов
          </p>

          {tab === 'reports' ? (
            <>
              {reports.length === 0 && (
                <p className={`${s.empty} ${s.list}`}>Жалоб нет.</p>
              )}
              {reportError && (
                <p className={s.error} role="alert">
                  {reportError}
                </p>
              )}
              {reports.map((g) => (
                <article key={keyOf(g)} className={s.report}>
                  <div className={s.reportTop}>
                    <span className={s.badge}>{TARGET_NAMES[g.target]}</span>
                    <span className={s.hint}>жалоб: {g.reports.length}</span>
                  </div>

                  {g.subject ? (
                    <>
                      {subjectLink(g) ? (
                        <Link to={subjectLink(g)!} className={s.subject}>
                          {g.subject.title} ›
                        </Link>
                      ) : (
                        <strong className={s.subject}>{g.subject.title}</strong>
                      )}
                      {g.subject.text && (
                        <p className={s.quote}>{g.subject.text}</p>
                      )}
                      <span className={s.hint}>Автор: {g.subject.author}</span>
                    </>
                  ) : (
                    <p className={s.hint}>Объект уже удалён.</p>
                  )}

                  <ul className={s.reasons}>
                    {g.reports.map((r) => (
                      <li key={r.id}>
                        <strong>{reasonLabel(g.target, r.reason)}</strong>
                        {r.comment && <span> — «{r.comment}»</span>}
                        <span className={s.hint}>
                          {' '}
                          · {r.reporter}, {timeAgo(r.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {banningKey === keyOf(g) ? (
                    <div className={s.banForm}>
                      <label className="field-label">
                        <span>Причина блокировки</span>
                        <textarea
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="Её увидит автор"
                        />
                      </label>
                      <div className={s.actions}>
                        <button type="button" onClick={() => setBanningKey('')}>
                          Отмена
                        </button>
                        <button
                          type="button"
                          className={s.danger}
                          disabled={!banReason.trim()}
                          onClick={() => resolve(g, true, banReason)}
                        >
                          Заблокировать
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={s.actions}>
                        <button type="button" onClick={() => resolve(g, false)}>
                          Нарушений нет
                        </button>
                        {g.subject && (
                          <button
                            type="button"
                            className={s.danger}
                            onClick={() => resolve(g, true)}
                          >
                            {ACTIONS[g.target].label}
                          </button>
                        )}
                      </div>
                      {g.subject && (
                        <button
                          type="button"
                          className={s.banLink}
                          onClick={() => startBan(g)}
                        >
                          {ACTIONS[g.target].label} и заблокировать автора
                        </button>
                      )}
                    </>
                  )}
                </article>
              ))}
            </>
          ) : tab === 'reviews' ? (
            <>
              {queue.reviews.length === 0 && (
                <p className={`${s.empty} ${s.list}`}>
                  Отзывов на проверку нет.
                </p>
              )}
              {reviewError && (
                <p className={s.error} role="alert">
                  {reviewError}
                </p>
              )}
              {queue.reviews.map((r) => (
                <article key={r.submissionId} className={s.report}>
                  <div className={s.reportTop}>
                    <span
                      className={s.stars}
                      aria-label={`Оценка ${r.rating} из 5`}
                    >
                      {'★'.repeat(r.rating)}
                      {'☆'.repeat(5 - r.rating)}
                    </span>
                    <span className={waitClass(r.queuedAt)}>
                      {waitingFor(r.queuedAt)}
                    </span>
                  </div>
                  <strong className={s.subject}>{r.orderTitle}</strong>
                  <p className={s.quote}>
                    {r.hasContacts && contactsFlag}
                    {r.review}
                  </p>
                  <span className={s.hint}>
                    {r.advertiser} о креаторе {r.creator}
                  </span>
                  <div className={s.actions}>
                    <button
                      type="button"
                      className={s.danger}
                      onClick={() => decideReview(r.submissionId, false)}
                    >
                      Удалить
                    </button>
                    <button
                      type="button"
                      onClick={() => decideReview(r.submissionId, true)}
                    >
                      Опубликовать
                    </button>
                  </div>
                </article>
              ))}
            </>
          ) : tab === 'orders' ? (
            <div className={s.list}>
              {queue.orders.length === 0 && (
                <p className={s.empty}>Заказов на проверку нет.</p>
              )}
              {queue.orders.map((o) => (
                <Link key={o.id} to={`/mod/orders/${o.id}`} className={s.row}>
                  <span className={s.main}>
                    <span className={s.title}>
                      {o.hasContacts && contactsFlag}
                      {o.title}
                    </span>
                    <span className={s.sub}>
                      {o.advertiser} · бюджет {formatMoney(o.budget)}
                      {o.budgetRaised && (
                        <span className={s.flag}> ↑ повышен</span>
                      )}
                    </span>
                  </span>
                  <span className={waitClass(o.queuedAt)}>
                    {waitingFor(o.queuedAt)}
                  </span>
                  <span className={s.chevron} aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          ) : tab === 'holds' ? (
            <div className={s.list}>
              {queue.holds.length === 0 && (
                <p className={s.empty}>Роликов с законченным холдом нет.</p>
              )}
              {queue.holds.map((v) => (
                <Link key={v.id} to={`/mod/videos/${v.id}`} className={s.row}>
                  <span className={s.main}>
                    <span className={s.title}>{v.orderTitle}</span>
                    <span className={s.sub}>
                      {v.creator} · зафиксировать итог просмотров
                    </span>
                  </span>
                  <span className={s.chevron} aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={s.list}>
              {queue.videos.length === 0 && (
                <p className={s.empty}>Видео на проверку нет.</p>
              )}
              {queue.videos.map((v) => (
                <Link key={v.id} to={`/mod/videos/${v.id}`} className={s.row}>
                  <span className={s.main}>
                    <span className={s.title}>{v.orderTitle}</span>
                    <span className={s.sub}>{v.creator}</span>
                  </span>
                  {v.submittedAt && (
                    <span className={waitClass(v.submittedAt)}>
                      {waitingFor(v.submittedAt)}
                    </span>
                  )}
                  <span className={s.chevron} aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <SupportLink label="Написать в поддержку" />
    </main>
  );
}
