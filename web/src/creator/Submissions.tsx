import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  claimOrder,
  errorText,
  fetchMySubmissions,
  type MySubmission,
  type SubmissionStatus,
} from '../api';
import {
  formatDate,
  formatDeadline,
  formatMoney,
  formatViews,
} from '../format';
import { i18next } from '../i18n';
import s from '../ui.module.css';

const ACTIVE = ['IN_PROGRESS', 'SUBMITTED', 'MODERATOR_APPROVED'];

/** Мои отклики — как в мини-аппе (webapp/src/views/MySubmissionsView.tsx и SubmissionCard). */
export function Submissions() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MySubmission[]>();
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'active' | 'done'>('active');

  const load = useCallback(() => {
    setError(false);
    fetchMySubmissions().then(setItems, () => setError(true));
  }, []);
  useEffect(load, [load]);

  const all = items ?? [];
  const active = all.filter((sub) => ACTIVE.includes(sub.status));
  /** Отклонённые и сгоревшие, по которым ещё можно прислать новую работу (только последнее видео по заказу). */
  const attention = all.filter(
    (sub) =>
      ['MODERATOR_REJECTED', 'ADVERTISER_REJECTED', 'SLOT_EXPIRED'].includes(
        sub.status,
      ) &&
      sub.latest &&
      sub.order.status === 'OPEN',
  );
  const done = all.filter(
    (sub) => !active.includes(sub) && !attention.includes(sub),
  );

  return (
    <div className={s.page}>
      <h1>{t('submissions.title')}</h1>
      <div
        className={s.chips}
        role="tablist"
        aria-label={t('submissions.filterAria')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => setTab('active')}
        >
          {t('submissions.active', { count: active.length + attention.length })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'done'}
          onClick={() => setTab('done')}
        >
          {t('submissions.done', { count: done.length })}
        </button>
      </div>

      {error ? (
        <div className={s.buttons}>
          <p className={s.hint}>{t('submissions.loadError')}</p>
          <button type="button" className={s.btn} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      ) : !items ? (
        <p className={s.hint}>{t('common.loading')}</p>
      ) : tab === 'active' ? (
        <>
          {active.length + attention.length === 0 && (
            <div className={s.card}>
              <h2>{t('submissions.emptyTitle')}</h2>
              <p className={s.hint}>{t('submissions.emptyText')}</p>
              <Link to="/" className={`${s.btn} ${s.primary} ${s.linkBtn}`}>
                {t('submissions.openCatalog')}
              </Link>
            </div>
          )}
          <div className={s.cards}>
            {active.map((sub) => (
              <SubmissionItem key={sub.id} submission={sub} />
            ))}
          </div>
          {attention.length > 0 && (
            <>
              <h2>{t('submissions.attention')}</h2>
              <div className={s.cards}>
                {attention.map((sub) => (
                  <SubmissionItem key={sub.id} submission={sub} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {done.length === 0 && (
            <div className={s.card}>
              <h2>{t('submissions.emptyDoneTitle')}</h2>
              <p className={s.hint}>{t('submissions.emptyDone')}</p>
            </div>
          )}
          <div className={s.cards}>
            {done.map((sub) => (
              <SubmissionItem key={sub.id} submission={sub} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Цвет метки статуса; текст — в словаре (submissionCard.status). */
const TONE: Record<SubmissionStatus, string> = {
  IN_PROGRESS: 'accentTone',
  SUBMITTED: 'warn',
  MODERATOR_APPROVED: 'success',
  MODERATOR_REJECTED: 'danger',
  SLOT_EXPIRED: 'danger',
};

type StepState = 'done' | 'now' | 'next' | 'fail';
interface Step {
  label: string;
  detail?: string;
  state: StepState;
}
const st = (key: string, opts?: Record<string, unknown>) =>
  i18next.t(`submissionCard.step.${key}`, opts);
const on = (iso: string | null) => (iso ? formatDate(iso) : undefined);

/** Просмотры и деньги по сданному ролику: на проверке — резерв, после одобрения — начислено. */
function earnings(sub: MySubmission) {
  const { status, views, payout } = sub;
  if (
    views === null ||
    (status !== 'SUBMITTED' && status !== 'MODERATOR_APPROVED')
  )
    return '';
  const money = i18next.t(
    status === 'SUBMITTED'
      ? 'submissionCard.reserved'
      : 'submissionCard.accrued',
    {
      amount: formatMoney(payout),
    },
  );
  // count — для формы слова («просмотр/просмотра/просмотров»), views — число с разделителями
  return `${i18next.t('submissionCard.views', { count: views, views: formatViews(views) })} · ${money}`;
}

/** Путь ролика по шагам: где он сейчас и что дальше — чтобы было видно, когда придут деньги. */
function timeline(sub: MySubmission): Step[] {
  const submitted: Step = {
    label: st('submitted'),
    detail: on(sub.submittedAt),
    state: 'done',
  };
  if (sub.status === 'SLOT_EXPIRED')
    return [
      { label: st('taken'), detail: on(sub.createdAt), state: 'done' },
      { label: st('expired'), state: 'fail' },
    ];
  if (sub.status === 'MODERATOR_REJECTED')
    return [
      submitted,
      {
        label: st('rejected'),
        detail: sub.comment ?? on(sub.decidedAt),
        state: 'fail',
      },
    ];
  if (sub.status === 'IN_PROGRESS')
    return [
      { label: st('taken'), detail: on(sub.createdAt), state: 'done' },
      {
        label: st('submitted'),
        // фонд занят роликами на проверке — срока нет, время на паузе
        detail: sub.fundPaused
          ? i18next.t('submissionCard.fundPaused')
          : sub.dueAt
            ? i18next.t('submissionCard.dueAt', {
                date: formatDeadline(sub.dueAt),
              })
            : undefined,
        state: 'now',
      },
      { label: st('review'), state: 'next' },
      { label: st('hold'), state: 'next' },
    ];
  if (sub.status === 'SUBMITTED')
    return [
      {
        ...submitted,
        detail: [on(sub.submittedAt), earnings(sub)]
          .filter(Boolean)
          .join(' · '),
      },
      { label: st('review'), detail: st('reviewNote'), state: 'now' },
      { label: st('accrual'), state: 'next' },
      { label: st('hold'), state: 'next' },
    ];
  // одобрен: холд идёт или уже закончился
  return [
    submitted,
    {
      label: st('approved'),
      detail: [on(sub.decidedAt), earnings(sub)].filter(Boolean).join(' · '),
      state: 'done',
    },
    sub.finalized
      ? { label: st('hold'), state: 'done' }
      : {
          label: st('holdUntil', { date: on(sub.holdEndsAt) }),
          detail: st('holdNote'),
          state: 'now',
        },
    { label: st('withdraw'), state: sub.finalized ? 'done' : 'next' },
  ];
}

/** Сколько дней холда осталось — в метке статуса, видно и в свёрнутой карточке. */
function holdLeft(end: string | null) {
  if (!end) return '';
  const days = Math.max(
    1,
    Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000),
  );
  return i18next.t('submissionCard.holdLeft', { count: days });
}

/** Отклик: статус, путь ролика по шагам, ссылка на товар и действие (сдать, прислать новое). */
function SubmissionItem({ submission }: { submission: MySubmission }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const status = submission.finalized
    ? { label: t('submissionCard.status.FINALIZED'), tone: 'success' }
    : {
        label: t(`submissionCard.status.${submission.status}`),
        tone: TONE[submission.status],
      };
  const rejected = ['MODERATOR_REJECTED', 'SLOT_EXPIRED'].includes(
    submission.status,
  );
  const canResubmit =
    rejected && submission.latest && submission.order.status === 'OPEN';
  const expired = submission.order.status === 'EXPIRED';
  /** Заказ изменён и правку не одобрили: сдавать нельзя, слот не тикает. */
  const frozen = ['PENDING_MODERATION', 'EDIT_REJECTED'].includes(
    submission.order.status,
  );

  /** Ссылка на товар для описания ролика — у каждого отклика своя, по ней считаем переходы (/r/ — и на домене сайта). */
  const trackUrl =
    submission.trackPath && !rejected
      ? location.origin + submission.trackPath
      : '';
  const [copied, setCopied] = useState(false);
  async function copyTrackUrl() {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopied(true);
    } catch {
      // буфер обмена недоступен — ссылка видна, её можно выделить вручную
    }
  }

  const [resubmitting, setResubmitting] = useState(false);
  const [error, setError] = useState('');

  /** Новое видео: откликаемся на тот же заказ заново и сразу идём его отправлять. */
  async function resubmit() {
    setResubmitting(true);
    setError('');
    try {
      const { submissionId } = await claimOrder(submission.order.id);
      await navigate(`/submissions/${submissionId}/video`);
    } catch (err) {
      setError(errorText(err, t('submissionCard.resubmitError')));
    } finally {
      setResubmitting(false);
    }
  }

  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <h2>{submission.order.title}</h2>
        {!!submission.payout && !rejected && (
          <strong>{formatMoney(submission.payout)}</strong>
        )}
      </div>
      <p className={s.hint}>
        <span className={`${s.badge} ${s[status.tone]}`}>
          {status.label}
          {holdLeft(submission.holdEndsAt)}
        </span>
        {submission.attempt > 1 &&
          ` ${t('submissionCard.attempt', { n: submission.attempt })}`}
      </p>

      <ol className={s.timeline}>
        {timeline(submission).map((step) => (
          <li
            key={step.label}
            className={s[step.state]}
            aria-current={step.state === 'now' ? 'step' : undefined}
          >
            <strong>{step.label}</strong>
            {step.detail && <span>{step.detail}</span>}
          </li>
        ))}
      </ol>
      {submission.dueAt && frozen && (
        <p className={`${s.hint} ${s.small}`}>{t('errors.orderFrozen')}</p>
      )}
      {submission.agreedPayout !== null && !rejected && (
        <p className={`${s.hint} ${s.small}`}>
          {t('submissionCard.agreed', {
            amount: formatMoney(submission.agreedPayout),
          })}
        </p>
      )}
      {trackUrl && (
        <div className={s.field}>
          <span className={`${s.hint} ${s.small}`}>
            {t('submissionCard.trackHint')}
          </span>
          <button type="button" className={s.wallet} onClick={copyTrackUrl}>
            <span>{trackUrl}</span>
            <small>
              {copied ? t('submissionCard.copied') : t('submissionCard.copy')}
            </small>
          </button>
        </div>
      )}

      {submission.status === 'IN_PROGRESS' && !expired ? (
        <Link
          to={`/submissions/${submission.id}/video`}
          className={`${s.btn} ${s.primary} ${s.linkBtn}`}
        >
          {t('submissionCard.sendVideo')}
        </Link>
      ) : canResubmit ? (
        <button
          type="button"
          className={`${s.btn} ${s.primary}`}
          disabled={resubmitting}
          onClick={resubmit}
        >
          {resubmitting
            ? t('submissionCard.wait')
            : t('submissionCard.resubmit')}
        </button>
      ) : (
        (submission.status === 'IN_PROGRESS' ||
          (rejected && submission.latest)) && (
          <p className={s.hint}>
            {expired
              ? t('submissionCard.orderExpired')
              : t('submissionCard.orderClosed')}
          </p>
        )
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
