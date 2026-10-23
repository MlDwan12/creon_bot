import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  fetchModFunnel,
  fetchModStats,
  type ModFunnel,
  type ModStats,
} from '../../api';
import { formatMoney } from '../../format';
import s from './ModStatsView.module.css';

const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];

/** Плитка: число и подпись. */
const Tile = ({
  value,
  label,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
}) => (
  <div className={s.tile}>
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

export default function ModStatsView() {
  const [stats, setStats] = useState<ModStats>();
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<number | undefined>(30);
  const [funnel, setFunnel] = useState<ModFunnel>();
  const [funnelError, setFunnelError] = useState('');
  const lastRequest = useRef(0);

  useEffect(() => {
    fetchModStats().then(setStats, () =>
      setError('Не удалось загрузить статистику'),
    );
  }, []);

  // Быстро переключили период — применяем только ответ на последний запрос.
  useEffect(() => {
    const requestId = ++lastRequest.current;
    setFunnelError('');
    fetchModFunnel(period).then(
      (f) => requestId === lastRequest.current && setFunnel(f),
      () =>
        requestId === lastRequest.current &&
        setFunnelError('Не удалось загрузить воронку'),
    );
  }, [period]);

  /** Этапы воронки заказов; процент — от созданных за период. */
  const o = funnel?.orders;
  const steps = o
    ? [
        { label: 'Создано', value: o.created },
        { label: 'Опубликовано', value: o.published },
        { label: 'С откликами', value: o.withClaims },
        { label: 'С присланным видео', value: o.withVideos },
        { label: 'С принятым видео', value: o.withAccepted },
      ].map((step) => ({
        ...step,
        percent: o.created ? Math.round((step.value / o.created) * 100) : 0,
      }))
    : [];
  const flushTitle = `section-title ${s.flush}`;
  const b = funnel?.business;

  return (
    <main className={s.page}>
      <h1>Статистика</h1>
      {error ? (
        <p className={s.hint}>{error}</p>
      ) : !stats ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        <>
          <h2 className={flushTitle}>
            Сейчас · заказов всего {stats.orders.total}
          </h2>
          <div className={s.tiles}>
            <Tile value={stats.orders.pending} label="на проверке" />
            <Tile value={stats.orders.open} label="открыто" />
            <Tile value={stats.orders.rejected} label="отклонено" />
            <Tile value={stats.orders.closed} label="закрыто" />
          </div>
          <div className={`${s.tiles} ${s.three}`}>
            <Tile
              value={stats.submissions.pending}
              label="видео на модерации"
            />
            <Tile value={stats.submissions.approved} label="роликов одобрено" />
            <Tile value={stats.submissions.rejected} label="видео отклонено" />
          </div>
        </>
      )}

      <Link to="/mod/what-works" className={s.linkRow}>
        <span>Что работает</span>
        <small>какие заказы берут, смотрят и одобряют · аудитория</small>
      </Link>

      <div className={s.segmented} role="tablist" aria-label="Период воронки">
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

      {funnelError ? (
        <p className={s.hint}>{funnelError}</p>
      ) : (
        funnel &&
        b && (
          <>
            <h2 className={flushTitle}>Бизнес</h2>
            <div className={s.tiles}>
              <Tile
                value={formatMoney(b.placed)}
                label={`вложено в заказы · в среднем ${b.avgBudget === null ? '—' : formatMoney(b.avgBudget)}`}
              />
              <Tile
                value={b.utilization === null ? '—' : `${b.utilization}%`}
                label={`бюджета освоено в ${b.finished} завершённых · меньше половины — ${b.underused}`}
              />
              <Tile
                value={
                  b.firstClaimHours === null ? '—' : `${b.firstClaimHours} ч`
                }
                label="от публикации до первого отклика (медиана)"
              />
              <Tile
                value={`${b.advertisers.repeat} из ${b.advertisers.total}`}
                label="рекламодателей заказывают повторно"
              />
              <Tile
                value={`${b.creators.repeat} из ${b.creators.total}`}
                label="креаторов с оплаченными роликами в 2+ заказах"
              />
              <Tile
                value={formatMoney(b.debt.owed)}
                label={`должны креаторам сейчас · в заявках ${formatMoney(b.debt.requested)}`}
              />
            </div>

            <h2 className={flushTitle}>Воронка заказов</h2>
            <ol className={s.rows}>
              {steps.map((step) => (
                <li key={step.label}>
                  <span>{step.label}</span>
                  <span>
                    <strong>{step.value}</strong>
                    {step.label !== 'Создано' && (
                      <small> · {step.percent}%</small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <p className={`${s.hint} ${s.small}`}>
              Отклонено модератором: {funnel.orders.rejected}. Медиана
              модерации:{' '}
              {funnel.orders.moderationHours === null
                ? '—'
                : `${funnel.orders.moderationHours} ч`}
              .
            </p>

            <h2 className={flushTitle}>
              Видео · прислано {funnel.videos.submitted}
            </h2>
            <div className={`${s.tiles} ${s.three}`}>
              <Tile value={funnel.videos.accepted} label="одобрено" />
              <Tile value={funnel.videos.pending} label="на проверке" />
              <Tile value={funnel.videos.moderatorRejected} label="отклонено" />
            </div>
            {funnel.rejectReasons.length > 0 && (
              <>
                <h2 className={flushTitle}>Почему отклоняют видео</h2>
                <ol className={s.rows}>
                  {funnel.rejectReasons.map((r) => (
                    <li key={r.reason}>
                      <span>{r.reason}</span>
                      <strong>{r.count}</strong>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <h2 className={flushTitle}>Пользователи</h2>
            <div className={`${s.tiles} ${s.three}`}>
              <Tile value={funnel.users.new} label="новых" />
              <Tile
                value={funnel.users.activeAdvertisers}
                label="рекламодателей"
              />
              <Tile value={funnel.users.activeCreators} label="креаторов" />
            </div>

            <h2 className={flushTitle}>Оборот</h2>
            <div className={s.tiles}>
              <Tile
                value={formatMoney(funnel.turnover.amount)}
                label="начислено креаторам за одобренные ролики"
              />
              <Tile
                value={formatMoney(funnel.turnover.fee)}
                label="комиссия площадки с этих роликов"
              />
            </div>
          </>
        )
      )}
    </main>
  );
}
