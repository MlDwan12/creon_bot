<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, claimOrder, type MySubmission, type SubmissionStatus } from '../api';
import { formatCpm, formatDeadline, formatMoney, formatViews } from '../format';
import { i18next } from '../i18n';

const props = defineProps<{ submission: MySubmission }>();
const router = useRouter();

/** Сколько из 4 этапов пройдено: в работе → ролик сдан → одобрен, начислено → холд закончился. */
const STEPS: Record<SubmissionStatus, number> = {
  IN_PROGRESS: 1,
  SUBMITTED: 2,
  MODERATOR_APPROVED: 3,
  MODERATOR_REJECTED: 0,
  SLOT_EXPIRED: 0,
};

/** Цвет метки статуса; текст — в словаре (submissionCard.status). */
const TONE: Record<SubmissionStatus, string> = {
  IN_PROGRESS: 'accent',
  SUBMITTED: 'warn',
  MODERATOR_APPROVED: 'success',
  MODERATOR_REJECTED: 'danger',
  SLOT_EXPIRED: 'danger',
};

// computed — значение, которое пересчитывается само, когда меняются props.
const steps = computed(() => (props.submission.finalized ? 4 : STEPS[props.submission.status]));
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
const rejected = computed(() => steps.value === 0);
const canResubmit = computed(
  () => rejected.value && props.submission.latest && props.submission.order.status === 'OPEN',
);
const expired = computed(() => props.submission.order.status === 'EXPIRED');
/** Заказ изменён и правку не одобрили: сдавать нельзя, слот не тикает (в работе — значит заказ публиковали). */
const frozen = computed(() => ['PENDING_MODERATION', 'EDIT_REJECTED'].includes(props.submission.order.status));

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
    <div class="top">
      <div class="title">{{ submission.order.title }}</div>
      <span class="price">{{ formatCpm(submission.order.cpm) }}</span>
    </div>

    <div v-if="!rejected" class="steps" aria-hidden="true">
      <span v-for="n in 4" :key="n" :class="{ done: n <= steps }" />
    </div>

    <div class="status">
      <span :class="['label', status.tone]">{{ status.label }}</span>
      <span v-if="submission.dueAt && frozen" class="hint">{{ $t('errors.orderFrozen') }}</span>
      <span v-else-if="submission.dueAt" class="hint">
        {{ $t('submissionCard.dueAt', { date: formatDeadline(submission.dueAt) }) }}
      </span>
      <span v-else-if="submission.attempt > 1" class="hint">{{ $t('submissionCard.attempt', { n: submission.attempt }) }}</span>
    </div>

    <p v-if="earnings" class="earnings">{{ earnings }}</p>
    <div v-if="trackUrl" class="track">
      <span class="hint">{{ $t('submissionCard.trackHint') }}</span>
      <code>{{ trackUrl }}</code>
      <button type="button" class="copy" @click="copyTrackUrl">{{ copied ? $t('submissionCard.copied') : $t('submissionCard.copy') }}</button>
    </div>
    <p v-if="submission.comment" class="comment">«{{ submission.comment }}»</p>

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
  min-height: 32px;
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
  gap: 12px;
}
.title {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.3;
}
.price {
  flex: none;
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--link);
}
.steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.steps span {
  height: 4px;
  border-radius: 2px;
  background: var(--separator);
}
.steps span.done {
  background: var(--accent);
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
.earnings {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.comment {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--fill);
  font-size: 15px;
  line-height: 1.4;
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
