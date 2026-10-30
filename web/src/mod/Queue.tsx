import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  approveReview,
  errorText,
  fetchModQueue,
  fetchModReports,
  type ModQueue,
  type ModReportGroup,
  reasonLabel,
  removeReview,
  type ReportTarget,
  resolveReports,
} from '../api';
import { formatMoney, isWaitingLong, timeAgo, waitingFor } from '../format';
import s from '../ui.module.css';
import { OrderReview } from './OrderReview';
import { VideoReview } from './VideoReview';

type Tab = 'videos' | 'orders' | 'holds' | 'reviews' | 'reports';
const TABS: { id: Tab; label: string }[] = [
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

const contactsFlag = (
  <span className={s.flag} title="Похоже на контакты в обход площадки">
    ⚠{' '}
  </span>
);

/**
 * Очередь — как в мини-аппе (webapp/src/views/mod/ModQueueView.tsx), но на широком экране:
 * видео, заказы и итоги — списком слева, открытый — справа; после решения открывается следующий.
 * Отзывы и жалобы решаются прямо в карточках.
 */
export function Queue() {
  const [query, setQuery] = useSearchParams();
  const [queue, setQueue] = useState<ModQueue>();
  const [reports, setReports] = useState<ModReportGroup[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  /** Карточка жалоб, в которой открыта форма блокировки автора, и причина. */
  const [banningKey, setBanningKey] = useState('');
  const [banReason, setBanReason] = useState('');

  const load = useCallback(
    () =>
      Promise.all([fetchModQueue(), fetchModReports()]).then(
        ([q, r]) => {
          setQueue(q);
          setReports(r);
          setError('');
        },
        () => setError('Не удалось загрузить очередь'),
      ),
    [],
  );
  useEffect(() => void load(), [load]);

  // Список листается вместе со страницей (без своей прокрутки): выбрали элемент далеко внизу —
  // карточка справа ушла за верх экрана, поднимаем к ней.
  const reviewRef = useRef<HTMLDivElement>(null);
  const selected = query.get('id');
  useEffect(() => {
    const el = reviewRef.current;
    if (selected && el && el.getBoundingClientRect().top < 0)
      el.scrollIntoView({ block: 'start' });
  }, [selected]);

  const counts: Record<Tab, number> = {
    videos: queue?.videos.length ?? 0,
    orders: queue?.orders.length ?? 0,
    holds: queue?.holds.length ?? 0,
    reviews: queue?.reviews.length ?? 0,
    reports: reports.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // вкладка и открытый элемент — в адресе: ссылку можно открыть в новой вкладке и вернуться назад.
  // Без вкладки — первая, где что-то ждёт; без элемента — первый в списке.
  const queryTab = query.get('tab') as Tab;
  const tab: Tab = TABS.some((t) => t.id === queryTab)
    ? queryTab
    : (TABS.find((t) => counts[t.id])?.id ?? 'videos');
  const setTab = (t: Tab) => setQuery({ tab: t });

  /** Самое старое ожидание — главный сигнал «пора разбирать». */
  const oldest = [
    ...(queue?.orders.map((o) => o.queuedAt) ?? []),
    ...(queue?.videos
      .map((v) => v.submittedAt)
      .filter((d): d is string => !!d) ?? []),
    ...(queue?.reviews.map((r) => r.queuedAt) ?? []),
  ].sort()[0];
  const waitClass = (iso: string) =>
    isWaitingLong(iso) ? `${s.wait} ${s.long}` : s.wait;

  /**
   * Решение принято — убираем его из списка сразу (не ждём ответа очереди), открываем первый
   * оставшийся во вкладке и перечитываем очередь.
   */
  function done(next: 'videos' | 'orders' | 'holds', decidedId: number) {
    setQueue(
      (q) => q && { ...q, [next]: q[next].filter((i) => i.id !== decidedId) },
    );
    setQuery({ tab: next }, { replace: true });
    void load();
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
    if (!window.confirm(question)) return;
    setActionError('');
    setBanningKey('');
    try {
      await resolveReports(
        group.target,
        group.targetId,
        actioned,
        banReasonText,
      );
    } catch (err) {
      setActionError(errorText(err));
    }
    void load();
  }

  /** Отзыв с проверки: опубликовать в профиле креатора или удалить (оценка пропадёт вместе с текстом). */
  async function decideReview(submissionId: number, publish: boolean) {
    if (
      !publish &&
      !window.confirm('Удалить отзыв? Оценка тоже не попадёт в рейтинг.')
    )
      return;
    setActionError('');
    try {
      await (publish
        ? approveReview(submissionId)
        : removeReview(submissionId));
    } catch (err) {
      setActionError(errorText(err));
    }
    void load();
  }

  if (error && !queue)
    return (
      <div className={s.page}>
        <h1>Очередь</h1>
        <p className={s.hint}>{error}</p>
      </div>
    );
  if (!queue)
    return (
      <div className={s.page}>
        <h1>Очередь</h1>
        <p className={s.hint}>Загрузка…</p>
      </div>
    );

  /** Строки списка слева: видео, заказы или итоги холда. */
  const items =
    tab === 'videos'
      ? queue.videos.map((v) => ({
          id: v.id,
          title: v.orderTitle,
          sub: (
            <>
              {v.creator}
              {/* пока не проверят, по заказу никто не сдаёт */}
              {v.holdsFund && (
                <span className={s.flag}> · держит фонд заказа</span>
              )}
            </>
          ),
          since: v.submittedAt,
        }))
      : tab === 'orders'
        ? queue.orders.map((o) => ({
            id: o.id,
            title: (
              <>
                {o.hasContacts && contactsFlag}
                {o.title}
              </>
            ),
            sub: (
              <>
                {o.advertiser} · {formatMoney(o.budget)}
                {o.budgetRaised && <span className={s.flag}> ↑ повышен</span>}
              </>
            ),
            since: o.queuedAt as string | null,
          }))
        : tab === 'holds'
          ? queue.holds.map((v) => ({
              id: v.id,
              title: v.orderTitle,
              sub: <>{v.creator} · итог просмотров</>,
              since: null as string | null,
            }))
          : [];
  const openId = Number(query.get('id')) || items[0]?.id;
  const open = items.find((i) => i.id === openId) ? openId : items[0]?.id;

  return (
    <div className={s.page}>
      <h1>Очередь</h1>
      <p className={s.hint}>
        {total ? `${total} ждут решения` : 'Всё разобрано'}
        {oldest && (
          <>
            {' · '}
            <span className={isWaitingLong(oldest) ? s.long : undefined}>
              самое старое — {waitingFor(oldest)}
            </span>
          </>
        )}
        {' · '}сначала самые старые, оранжевым — ждут дольше 4 часов
      </p>
      <div className={s.chips} role="tablist" aria-label="Очередь">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={counts[t.id] ? undefined : s.dim}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className={s.count}>{counts[t.id]}</span>
          </button>
        ))}
      </div>
      {error && <p className={s.error}>{error}</p>}
      {actionError && (
        <p className={s.error} role="alert">
          {actionError}
        </p>
      )}

      {tab === 'reports' ? (
        reports.length === 0 ? (
          <p className={s.hint}>Жалоб нет.</p>
        ) : (
          reports.map((g) => (
            <article key={keyOf(g)} className={s.card}>
              <p className={s.hint}>
                <span className={s.badge}>{TARGET_NAMES[g.target]}</span> жалоб:{' '}
                {g.reports.length}
              </p>
              {g.subject ? (
                <>
                  {subjectLink(g) ? (
                    <Link to={subjectLink(g)!}>
                      <strong>{g.subject.title} ›</strong>
                    </Link>
                  ) : (
                    <strong>{g.subject.title}</strong>
                  )}
                  {g.subject.text && (
                    <p className={s.quote}>{g.subject.text}</p>
                  )}
                  <span className={s.hint}>Автор: {g.subject.author}</span>
                </>
              ) : (
                <p className={s.hint}>Объект уже удалён.</p>
              )}
              <ul>
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
                <>
                  <label className={s.field}>
                    <span>Причина блокировки</span>
                    <textarea
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Её увидит автор"
                    />
                  </label>
                  <div className={s.buttons}>
                    <button
                      type="button"
                      className={s.btn}
                      onClick={() => setBanningKey('')}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className={`${s.btn} ${s.rejectSolid}`}
                      disabled={!banReason.trim()}
                      onClick={() => resolve(g, true, banReason)}
                    >
                      Заблокировать
                    </button>
                  </div>
                </>
              ) : (
                <div className={s.buttons}>
                  <button
                    type="button"
                    className={s.btn}
                    onClick={() => resolve(g, false)}
                  >
                    Нарушений нет
                  </button>
                  {g.subject && (
                    <>
                      <button
                        type="button"
                        className={`${s.btn} ${s.reject}`}
                        onClick={() => resolve(g, true)}
                      >
                        {ACTIONS[g.target].label}
                      </button>
                      <button
                        type="button"
                        className={`${s.btn} ${s.reject}`}
                        onClick={() => {
                          setBanningKey(keyOf(g));
                          setBanReason(
                            reasonLabel(g.target, g.reports[0].reason),
                          );
                        }}
                      >
                        {ACTIONS[g.target].label} и заблокировать автора
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))
        )
      ) : tab === 'reviews' ? (
        queue.reviews.length === 0 ? (
          <p className={s.hint}>Отзывов на проверку нет.</p>
        ) : (
          queue.reviews.map((r) => (
            <article key={r.submissionId} className={s.card}>
              <p className={s.hint}>
                <span aria-label={`Оценка ${r.rating} из 5`}>
                  {'★'.repeat(r.rating)}
                  {'☆'.repeat(5 - r.rating)}
                </span>{' '}
                ·{' '}
                <span className={waitClass(r.queuedAt)}>
                  {waitingFor(r.queuedAt)}
                </span>
              </p>
              <strong>{r.orderTitle}</strong>
              <p className={s.quote}>
                {r.hasContacts && contactsFlag}
                {r.review}
              </p>
              <span className={s.hint}>
                {r.advertiser} о креаторе {r.creator}
              </span>
              <div className={s.buttons}>
                <button
                  type="button"
                  className={`${s.btn} ${s.approve}`}
                  onClick={() => decideReview(r.submissionId, true)}
                >
                  Опубликовать
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.reject}`}
                  onClick={() => decideReview(r.submissionId, false)}
                >
                  Удалить
                </button>
              </div>
            </article>
          ))
        )
      ) : (
        <div className={s.split}>
          <div className={s.pane}>
            {items.length === 0 ? (
              <p className={s.hint}>
                {tab === 'videos'
                  ? 'Видео на проверку нет.'
                  : tab === 'orders'
                    ? 'Заказов на проверку нет.'
                    : 'Роликов с законченным холдом нет.'}
              </p>
            ) : (
              <div className={s.list}>
                {items.map((i) => (
                  <Link
                    key={i.id}
                    to={`?tab=${tab}&id=${i.id}`}
                    className={s.item}
                    aria-current={i.id === open}
                  >
                    <span className={s.itemMain}>
                      <span className={s.itemTitle}>{i.title}</span>
                      <span className={s.itemSub}>{i.sub}</span>
                    </span>
                    {i.since && (
                      <span className={waitClass(i.since)}>
                        {waitingFor(i.since)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div ref={reviewRef}>
            {open !== undefined &&
              (tab === 'orders' ? (
                <OrderReview
                  key={open}
                  id={open}
                  onDone={() => done('orders', open)}
                />
              ) : (
                <VideoReview
                  key={open}
                  id={open}
                  onDone={(t) => done(t, open)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
