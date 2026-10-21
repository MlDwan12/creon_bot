<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, claimOrder, type MySubmission, type SubmissionStatus } from '../api';
import { formatDate, formatDeadline, formatMoney, formatViews } from '../format';
import { i18next } from '../i18n';

const props = defineProps<{ submission: MySubmission }>();
const router = useRouter();

/** Цвет метки статуса; текст — в словаре (submissionCard.status). */
const TONE: Record<SubmissionStatus, string> = {
  IN_PROGRESS: 'accent',
  SUBMITTED: 'warn',
  MODERATOR_APPROVED: 'success',
  MODERATOR_REJECTED: 'danger',
  SLOT_EXPIRED: 'danger',
};

// computed — значение, которое пересчитывается само, когда меняются props.
const status = computed(() =>
  props.submission.finalized
    ? { label: i18next.t('submissionCard.status.FINALIZED'), tone: 'success' }
    : {
        label: i18next.t(`submissionCard.status.${props.submission.status}`),
        tone: TONE[props.submission.status],
      },
);
/** Просмотры и деньги по сданному ролику: на проверке — резерв, после одобрения — начислено. */
const earnings = computed(() => {
  const { status: st, views, payout } = props.submission;
  if (views === null || (st !== 'SUBMITTED' && st !== 'MODERATOR_APPROVED')) return '';
  const money = i18next.t(st === 'SUBMITTED' ? 'submissionCard.reserved' : 'submissionCard.accrued', {
    amount: formatMoney(payout),
  });
  // count — для формы слова («просмотр/просмотра/просмотров»), views — число с разделителями
  return `${i18next.t('submissionCard.views', { count: views, views: formatViews(views) })} · ${money}`;
});
const rejected = computed(() => ['MODERATOR_REJECTED', 'SLOT_EXPIRED'].includes(props.submission.status));
const canResubmit = computed(
  () => rejected.value && props.submission.latest && props.submission.order.status === 'OPEN',
);
const expired = computed(() => props.submission.order.status === 'EXPIRED');
/** Заказ изменён и правку не одобрили: сдавать нельзя, слот не тикает (в работе — значит заказ публиковали). */
const frozen = computed(() => ['PENDING_MODERATION', 'EDIT_REJECTED'].includes(props.submission.order.status));

type StepState = 'done' | 'now' | 'next' | 'fail';
interface Step {
  label: string;
  detail?: string;
  state: StepState;
}
const t = (key: string, opts?: Record<string, unknown>) => i18next.t(`submissionCard.step.${key}`, opts);
const on = (iso: string | null) => (iso ? formatDate(iso) : undefined);

/** Путь ролика по шагам: где он сейчас и что дальше — чтобы было видно, когда придут деньги. */
const timeline = computed<Step[]>(() => {
  const s = props.submission;
  const submitted: Step = { label: t('submitted'), detail: on(s.submittedAt), state: 'done' };
  if (s.status === 'SLOT_EXPIRED')
    return [{ label: t('taken'), detail: on(s.createdAt), state: 'done' }, { label: t('expired'), state: 'fail' }];
  if (s.status === 'MODERATOR_REJECTED')
    return [submitted, { label: t('rejected'), detail: s.comment ?? on(s.decidedAt), state: 'fail' }];
  if (s.status === 'IN_PROGRESS')
    return [
      { label: t('taken'), detail: on(s.createdAt), state: 'done' },
      {
        label: t('submitted'),
        detail: s.dueAt ? i18next.t('submissionCard.dueAt', { date: formatDeadline(s.dueAt) }) : undefined,
        state: 'now',
      },
      { label: t('review'), state: 'next' },
      { label: t('hold'), state: 'next' },
    ];
  if (s.status === 'SUBMITTED')
    return [
      { ...submitted, detail: [on(s.submittedAt), earnings.value].filter(Boolean).join(' · ') },
      { label: t('review'), detail: t('reviewNote'), state: 'now' },
      { label: t('accrual'), state: 'next' },
      { label: t('hold'), state: 'next' },
    ];
  // одобрен: холд идёт или уже закончился
  return [
    submitted,
    { label: t('approved'), detail: [on(s.decidedAt), earnings.value].filter(Boolean).join(' · '), state: 'done' },
    s.finalized
      ? { label: t('hold'), state: 'done' }
      : { label: t('holdUntil', { date: on(s.holdEndsAt) }), detail: t('holdNote'), state: 'now' },
    { label: t('withdraw'), state: s.finalized ? 'done' : 'next' },
  ];
});

/** Сколько дней холда осталось — в метке статуса, видно и в свёрнутой карточке. */
const holdLeft = computed(() => {
  const end = props.submission.holdEndsAt;
  if (!end) return '';
  const days = Math.max(1, Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000));
  return i18next.t('submissionCard.holdLeft', { count: days });
});

/** Ссылка на товар для описания ролика — у каждого отклика своя, по ней считаем переходы. */
const trackUrl = computed(() =>
  props.submission.trackPath && !rejected.value ? location.origin + props.submission.trackPath : '',
);
const copied = ref(false);
async function copyTrackUrl() {
  try {
    await navigator.clipboard.writeText(trackUrl.value);
    copied.value = true;
  } catch {
    // буфер обмена недоступен (старый WebView) — ссылка видна, её можно выделить вручную
  }
}

/** Раскрыта ли шкала: сразу — если ждёт действия креатора (сдать видео или прислать новое). */
const open = ref(canResubmit.value || (props.submission.status === 'IN_PROGRESS' && !expired.value));

const resubmitting = ref(false);
const error = ref('');

/** Новое видео: откликаемся на тот же заказ заново и сразу идём его отправлять. */
async function resubmit() {
  resubmitting.value = true;
  error.value = '';
  try {
    const { submissionId } = await claimOrder(props.submission.order.id);
    await router.push(`/submissions/${submissionId}/video`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('submissionCard.resubmitError');
  } finally {
    resubmitting.value = false;
  }
}
</script>

<template>
  <article class="card">
    <button type="button" class="head" :aria-expanded="open" :aria-controls="`steps-${submission.id}`" @click="open = !open">
      <span class="top">
        <span class="title">{{ submission.order.title }}</span>
        <span v-if="submission.payout && !rejected" class="money payout">{{ formatMoney(submission.payout) }}</span>
      </span>
      <span class="status">
        <span :class="['label', status.tone]">{{ status.label }}{{ holdLeft }}</span>
        <span v-if="submission.attempt > 1" class="hint">{{ $t('submissionCard.attempt', { n: submission.attempt }) }}</span>
        <svg :class="['chevron', { up: open }]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </button>

    <ol v-if="open" :id="`steps-${submission.id}`" class="steps">
      <li v-for="step in timeline" :key="step.label" :class="step.state" :aria-current="step.state === 'now' ? 'step' : undefined">
        <span class="dot" aria-hidden="true">
          <svg v-if="step.state === 'done'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          <svg v-else-if="step.state === 'fail'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </span>
        <span class="step-text">
          <strong>{{ step.label }}</strong>
          <span v-if="step.detail">{{ step.detail }}</span>
        </span>
      </li>
    </ol>
    <span v-if="open && submission.dueAt && frozen" class="hint">{{ $t('errors.orderFrozen') }}</span>
    <div v-if="open && trackUrl" class="track">
      <span class="hint">{{ $t('submissionCard.trackHint') }}</span>
      <code>{{ trackUrl }}</code>
      <button type="button" class="copy" @click="copyTrackUrl">{{ copied ? $t('submissionCard.copied') : $t('submissionCard.copy') }}</button>
    </div>
    
    <RouterLink
      v-if="submission.status === 'IN_PROGRESS' && !expired"
      :to="`/submissions/${submission.id}/video`"
      class="action"
    >
      {{ $t('submissionCard.sendVideo') }}
    </RouterLink>
    <button v-else-if="canResubmit" type="button" class="action" :disabled="resubmitting" @click="resubmit">
      {{ resubmitting ? $t('submissionCard.wait') : $t('submissionCard.resubmit') }}
    </button>
    <p v-else-if="submission.status === 'IN_PROGRESS' || (rejected && submission.latest)" class="hint">
      {{ expired ? $t('submissionCard.orderExpired') : $t('submissionCard.orderClosed') }}
    </p>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.track {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.track code {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.copy {
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: var(--fill);
  color: var(--text);
  font-size: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.title {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.3;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin: -4px;
  padding: 4px;
  border: none;
  border-radius: 14px;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
}
.payout {
  flex: none;
  padding: 4px 10px;
  border-radius: 10px;
  background: var(--lime);
  color: var(--lime-text);
  font-size: 15px;
}
.chevron {
  flex: none;
  margin-left: auto;
  color: var(--hint);
  transition: transform 0.2s;
}
.chevron.up {
  transform: rotate(180deg);
}
.steps {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 4px 0 0;
  list-style: none;
}
.steps li {
  position: relative;
  display: grid;
  grid-template-columns: 24px 1fr;
  column-gap: 12px;
  padding-bottom: 14px;
}
.steps li:last-child {
  padding-bottom: 0;
}
/* линия между точками */
.steps li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 24px;
  bottom: 0;
  width: 2px;
  background: var(--separator);
}
.steps li.done:not(:last-child)::before {
  background: var(--success-text);
}
.dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  box-sizing: border-box;
  border-radius: 50%;
}
.done .dot {
  background: var(--success-soft);
  color: var(--success-text);
}
/* тёмная обводка — лайм на белом сам по себе почти не виден; в тёмной теме она сливается с фоном */
.now .dot {
  border: 2px solid var(--lime-text);
  background: var(--lime);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--lime) 25%, transparent);
}
.next .dot {
  border: 2px solid var(--separator);
}
.fail .dot {
  background: var(--danger-soft);
  color: var(--danger);
}
.step-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
  font-size: 15px;
}
.step-text span {
  color: var(--hint);
  font-size: 13px;
  line-height: 1.4;
}
.next .step-text strong {
  color: var(--hint);
  font-weight: 600;
}
.fail .step-text strong {
  color: var(--danger);
}
.status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
/* Статус — цветная плашка: цвет вместе со словом, не одним цветом. */
.label {
  padding: 5px 10px;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 800;
}
.label.accent {
  background: var(--accent-soft);
  color: var(--link);
}
.label.warn {
  background: var(--orange-soft);
  color: var(--orange-text);
}
.label.success {
  background: var(--success-soft);
  color: var(--success-text);
}
.label.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border: none;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 16px;
  font-weight: 800;
  text-decoration: none;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
