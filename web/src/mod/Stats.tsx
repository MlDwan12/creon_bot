import { type ReactNode, useEffect, useState } from 'react';
import { fetchModFunnel, fetchModStats, type ModStats } from '../api';
import { formatMoney } from '../format';
import s from './mod.module.css';
import { Period } from './Period';
import { useLatest } from './useLatest';

const Tile = ({ value, label }: { value: ReactNode; label: ReactNode }) => (
  <div className={s.tile}>
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

/** Статистика площадки — как в мини-аппе (webapp/src/views/mod/ModStatsView.tsx). */
export function Stats() {
  const [stats, setStats] = useState<ModStats>();
  const [statsError, setStatsError] = useState(false);
  const [period, setPeriod] = useState<number | undefined>(30);
  const funnelRes = useLatest(fetchModFunnel, period);
  const funnel = funnelRes.data;

  useEffect(() => {
    fetchModStats().then(setStats, () => setStatsError(true));
  }, []);

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
  const b = funnel?.business;

  return (
    <div className={s.page}>
      <h1>Статистика</h1>
      {statsError ? (
        <p className={s.hint}>Не удалось загрузить статистику</p>
      ) : !stats ? (
        <p className={s.hint}>Загрузка…</p>
      ) : (
        <>
          <h2>Сейчас · заказов всего {stats.orders.total}</h2>
          <div className={s.tiles}>
            <Tile value={stats.orders.pending} label="заказов на проверке" />
            <Tile value={stats.orders.open} label="открыто" />
            <Tile value={stats.orders.rejected} label="отклонено" />
            <Tile value={stats.orders.closed} label="закрыто" />
            <Tile
              value={stats.submissions.pending}
              label="видео на модерации"
            />
            <Tile value={stats.submissions.approved} label="роликов одобрено" />
            <Tile value={stats.submissions.rejected} label="видео отклонено" />
          </div>
        </>
      )}

      <Period value={period} onChange={setPeriod} />

      {funnelRes.error ? (
        <p className={s.hint}>Не удалось загрузить воронку</p>
      ) : (
        funnel &&
        b && (
          <>
            <h2>Бизнес</h2>
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

            <h2>Воронка заказов</h2>
            <div className={s.card}>
              {steps.map((step) => (
                <div key={step.label}>
                  <div className={s.row}>
                    <span>{step.label}</span>
                    <span>
                      {step.value}
                      {step.label !== 'Создано' && ` · ${step.percent}%`}
                    </span>
                  </div>
                  <div className={s.bar}>
                    <span style={{ width: `${step.percent}%` }} />
                  </div>
                </div>
              ))}
              <p className={`${s.hint} ${s.small}`}>
                Отклонено модератором: {funnel.orders.rejected}. Медиана
                модерации:{' '}
                {funnel.orders.moderationHours === null
                  ? '—'
                  : `${funnel.orders.moderationHours} ч`}
                .
              </p>
            </div>

            <h2>Видео · прислано {funnel.videos.submitted}</h2>
            <div className={s.tiles}>
              <Tile value={funnel.videos.accepted} label="одобрено" />
              <Tile value={funnel.videos.pending} label="на проверке" />
              <Tile value={funnel.videos.moderatorRejected} label="отклонено" />
            </div>
            {funnel.rejectReasons.length > 0 && (
              <>
                <h2>Почему отклоняют видео</h2>
                <ol className={s.rows}>
                  {funnel.rejectReasons.map((r) => (
                    <li key={r.reason} className={s.row}>
                      <span>{r.reason}</span>
                      <span>{r.count}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <h2>Пользователи</h2>
            <div className={s.tiles}>
              <Tile value={funnel.users.new} label="новых" />
              <Tile
                value={funnel.users.activeAdvertisers}
                label="рекламодателей"
              />
              <Tile value={funnel.users.activeCreators} label="креаторов" />
            </div>

            <h2>Оборот</h2>
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
    </div>
  );
}
