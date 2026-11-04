import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  creatorHome,
  LESSON_SEEN_KEY,
  START_HIDDEN_KEY,
  type StartStep,
} from '@fixum/shared';
import { fetchBalance, fetchMySubmissions, fetchSocialAccounts } from '../api';
import { formatDate, formatDeadline, formatMoney } from '../format';
import s from '../ui.module.css';

/** Куда ведёт пункт чек-листа «Старт»; заказ берут прямо в каталоге под карточкой. */
const STEP_LINK: Record<StartStep, string | null> = {
  wallet: '/profile',
  account: '/profile',
  order: null,
  lesson: '/learn',
};

/**
 * «Сейчас важно» сверху каталога — как в мини-аппе (webapp/src/components/CreatorHome.tsx): деньги, ближайший слот, отклики после отказа и чек-лист новичка.
 * Не загрузилось или показывать нечего — карточки нет: каталог главнее.
 */
export function CreatorHome() {
  const { t } = useTranslation();
  const [home, setHome] = useState<ReturnType<typeof creatorHome>>();
  const [startHidden, setStartHidden] = useState(
    () => localStorage.getItem(START_HIDDEN_KEY) === '1',
  );
  useEffect(() => {
    Promise.all([
      fetchBalance(),
      fetchMySubmissions(),
      fetchSocialAccounts().catch(() => []),
    ]).then(
      ([balance, subs, accounts]) =>
        setHome(
          creatorHome(
            balance,
            subs,
            accounts,
            localStorage.getItem(LESSON_SEEN_KEY) === '1',
          ),
        ),
      () => {},
    );
  }, []);
  if (!home) return null;

  const { money, due, resubmit } = home;
  const start = startHidden ? null : home.start;
  if (!money && !due && !resubmit && !start) return null;

  return (
    <section className={s.list} aria-label={t('home.title')}>
      {money && (
        <Link to="/balance" className={s.item}>
          <span>
            <strong>
              {t('home.money', { available: formatMoney(money.available) })}
            </strong>
            {money.held > 0 &&
              (money.releaseAt
                ? t('home.moneyHeldUntil', {
                    held: formatMoney(money.held),
                    date: formatDate(money.releaseAt),
                  })
                : t('home.moneyHeld', { held: formatMoney(money.held) }))}
          </span>
          <span aria-hidden="true" style={{ marginLeft: 'auto' }}>
            ›
          </span>
        </Link>
      )}
      {due && (
        <Link to={`/submissions/${due.id}/video`} className={s.item}>
          <span>
            {t('home.due', {
              title: due.order.title,
              date: formatDeadline(due.dueAt!),
            })}
          </span>
          <span aria-hidden="true" style={{ marginLeft: 'auto' }}>
            ›
          </span>
        </Link>
      )}
      {resubmit > 0 && (
        <Link to="/submissions" className={s.item}>
          <span>{t('home.resubmit', { count: resubmit })}</span>
          <span aria-hidden="true" style={{ marginLeft: 'auto' }}>
            ›
          </span>
        </Link>
      )}
      {start && (
        <div className={s.item} style={{ display: 'block' }}>
          <div className={s.row}>
            <strong>{t('home.startTitle')}</strong>
            <span className={`${s.hint} ${s.small}`}>
              {t('home.startDone', {
                done: start.filter((x) => x.done).length,
                total: start.length,
              })}
            </span>
            <button
              type="button"
              className={`${s.btn} ${s.small}`}
              onClick={() => {
                localStorage.setItem(START_HIDDEN_KEY, '1');
                setStartHidden(true);
              }}
            >
              {t('home.hide')}
            </button>
          </div>
          <ul>
            {start.map(({ step, done }) => {
              const label = (
                <>
                  <span aria-hidden="true">{done ? '✓' : '○'}</span>{' '}
                  {t(`home.step.${step}`)}
                </>
              );
              const to = STEP_LINK[step];
              return (
                <li key={step} className={done ? s.muted : undefined}>
                  {to && !done ? <Link to={to}>{label}</Link> : label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
