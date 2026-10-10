<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, claimOrder, type MySubmission, type SubmissionStatus } from '../api';
import { formatCpm, formatDeadline, formatMoney, formatViews } from '../format';

const props = defineProps<{ submission: MySubmission }>();
const router = useRouter();

/** Сколько из 4 этапов пройдено: в работе → ролик сдан → одобрен, начислено → итог после добора. */
const STEPS: Record<SubmissionStatus, number> = {
  IN_PROGRESS: 1,
  SUBMITTED: 2,
  MODERATOR_APPROVED: 3,
  MODERATOR_REJECTED: 0,
  SLOT_EXPIRED: 0,
};

const STATUS: Record<SubmissionStatus, { label: string; tone: string }> = {
  IN_PROGRESS: { label: 'В работе', tone: 'accent' },
  SUBMITTED: { label: 'На проверке у модератора', tone: 'warn' },
  MODERATOR_APPROVED: { label: 'Одобрено — идёт добор просмотров', tone: 'success' },
  MODERATOR_REJECTED: { label: 'Отклонено модератором', tone: 'danger' },
  SLOT_EXPIRED: { label: 'Слот сгорел — видео не прислали за 7 дней', tone: 'danger' },
};

// computed — значение, которое пересчитывается само, когда меняются props.
const steps = computed(() => (props.submission.finalized ? 4 : STEPS[props.submission.status]));
const status = computed(() =>
  props.submission.finalized ? { label: 'Итог зафиксирован', tone: 'success' } : STATUS[props.submission.status],
);
/** Просмотры и деньги по сданному ролику: на проверке — резерв, после одобрения — начислено. */
const earnings = computed(() => {
  const { status: st, views, payout } = props.submission;
  if (views === null || (st !== 'SUBMITTED' && st !== 'MODERATOR_APPROVED')) return '';
  const money = st === 'SUBMITTED' ? `в резерве ${formatMoney(payout)}` : `начислено ${formatMoney(payout)}`;
  return `${formatViews(views)} просмотров · ${money}`;
});
const rejected = computed(() => steps.value === 0);
const canResubmit = computed(
  () => rejected.value && props.submission.latest && props.submission.order.status === 'OPEN',
);
const expired = computed(() => props.submission.order.status === 'EXPIRED');

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
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось начать новую попытку';
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
      <span v-if="submission.dueAt" class="hint">
        сдать до {{ formatDeadline(submission.dueAt) }}
      </span>
      <span v-else-if="submission.attempt > 1" class="hint">видео {{ submission.attempt }}</span>
    </div>

    <p v-if="earnings" class="earnings">{{ earnings }}</p>
    <div v-if="trackUrl" class="track">
      <span class="hint">Ссылка на товар — поставьте в описание ролика:</span>
      <code>{{ trackUrl }}</code>
      <button type="button" class="copy" @click="copyTrackUrl">{{ copied ? 'Скопировано' : 'Скопировать' }}</button>
    </div>
    <p v-if="submission.comment" class="comment">«{{ submission.comment }}»</p>

    <RouterLink
      v-if="submission.status === 'IN_PROGRESS' && !expired"
      :to="`/submissions/${submission.id}/video`"
      class="action"
    >
      Отправить видео
    </RouterLink>
    <button v-else-if="canResubmit" type="button" class="action" :disabled="resubmitting" @click="resubmit">
      {{ resubmitting ? 'Секунду…' : 'Отправить новую работу' }}
    </button>
    <p v-else-if="submission.status === 'IN_PROGRESS' || (rejected && submission.latest)" class="hint">
      {{ expired ? 'Срок заказа истёк' : 'Заказ закрыт' }} — новые видео по нему не принимаются.
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
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.price {
  flex: none;
  font-size: 16px;
  font-weight: 700;
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
.label {
  font-weight: 600;
}
.label.accent {
  color: var(--link);
}
.label.warn {
  color: #9a5200;
}
.label.success {
  color: #1e7b34;
}
.label.danger {
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
  min-height: 44px;
  border: none;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
