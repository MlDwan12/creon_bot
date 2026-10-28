import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  ApiError,
  claimOrder,
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
import s from './SubmissionCard.module.css';

/** Цвет метки статуса; текст — в словаре (submissionCard.status). */
const TONE: Record<SubmissionStatus, string> = {
  IN_PROGRESS: 'accent',
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

export default function SubmissionCard({
  submission,
}: {
  submission: MySubmission;
}) {
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
  /** Заказ изменён и правку не одобрили: сдавать нельзя, слот не тикает (в работе — значит заказ публиковали). */
  const frozen = ['PENDING_MODERATION', 'EDIT_REJECTED'].includes(
    submission.order.status,
  );

  /** Ссылка на товар для описания ролика — у каждого отклика своя, по ней считаем переходы. */
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
      // буфер обмена недоступен (старый WebView) — ссылка видна, её можно выделить вручную
    }
  }

  /** Раскрыта ли шкала: сразу — если ждёт действия креатора (сдать видео или прислать новое). */
  const [open, setOpen] = useState(
    canResubmit || (submission.status === 'IN_PROGRESS' && !expired),
  );
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
      setError(
        err instanceof ApiError
          ? err.userMessage
          : t('submissionCard.resubmitError'),
      );
    } finally {
      setResubmitting(false);
    }
  }

  return (
    <article className={s.card}>
      <button
        type="button"
        className={s.head}
        aria-expanded={open}
        aria-controls={`steps-${submission.id}`}
        onClick={() => setOpen(!open)}
      >
        <span className={s.top}>
          <span className={s.title}>{submission.order.title}</span>
          {!!submission.payout && !rejected && (
            <span className={`money ${s.payout}`}>
              {formatMoney(submission.payout)}
            </span>
          )}
        </span>
        <span className={s.status}>
          <span className={`${s.label} ${s[status.tone]}`}>
            {status.label}
            {holdLeft(submission.holdEndsAt)}
          </span>
          {submission.attempt > 1 && (
            <span className={s.hint}>
              {t('submissionCard.attempt', { n: submission.attempt })}
            </span>
          )}
          <svg
            className={open ? `${s.chevron} ${s.up}` : s.chevron}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <ol id={`steps-${submission.id}`} className={s.steps}>
          {timeline(submission).map((step) => (
            <li
              key={step.label}
              className={s[step.state]}
              aria-current={step.state === 'now' ? 'step' : undefined}
            >
              <span className={s.dot} aria-hidden="true">
                {step.state === 'done' ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                ) : (
                  step.state === 'fail' && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    >
                      <path d="M7 7l10 10M17 7L7 17" />
                    </svg>
                  )
                )}
              </span>
              <span className={s.stepText}>
                <strong>{step.label}</strong>
                {step.detail && <span>{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {open && submission.dueAt && frozen && (
        <span className={s.hint}>{t('errors.orderFrozen')}</span>
      )}
      {open && submission.agreedPayout !== null && !rejected && (
        <span className={s.hint}>
          {t('submissionCard.agreed', {
            amount: formatMoney(submission.agreedPayout),
          })}
        </span>
      )}
      {open && trackUrl && (
        <div className={s.track}>
          <span className={s.hint}>{t('submissionCard.trackHint')}</span>
          <code>{trackUrl}</code>
          <button type="button" className={s.copy} onClick={copyTrackUrl}>
            {copied ? t('submissionCard.copied') : t('submissionCard.copy')}
          </button>
        </div>
      )}

      {submission.status === 'IN_PROGRESS' && !expired ? (
        <Link to={`/submissions/${submission.id}/video`} className={s.action}>
          {t('submissionCard.sendVideo')}
        </Link>
      ) : canResubmit ? (
        <button
          type="button"
          className={s.action}
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
