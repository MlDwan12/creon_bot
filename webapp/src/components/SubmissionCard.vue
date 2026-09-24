<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, claimOrder, type MySubmission, type SubmissionStatus } from '../api';
import { formatDate, formatPrice } from '../format';

const props = defineProps<{ submission: MySubmission }>();
const router = useRouter();

/** Сколько из 4 этапов пройдено: в работе → видео отправлено → модератор → рекламодатель. */
const STEPS: Record<SubmissionStatus, number> = {
  IN_PROGRESS: 1,
  SUBMITTED: 2,
  MODERATOR_APPROVED: 3,
  ADVERTISER_APPROVED: 4,
  MODERATOR_REJECTED: 0,
  ADVERTISER_REJECTED: 0,
};

const STATUS: Record<SubmissionStatus, { label: string; tone: string }> = {
  IN_PROGRESS: { label: 'В работе', tone: 'accent' },
  SUBMITTED: { label: 'На проверке у модератора', tone: 'warn' },
  MODERATOR_APPROVED: { label: 'Ждёт решения рекламодателя', tone: 'warn' },
  ADVERTISER_APPROVED: { label: 'Принято рекламодателем', tone: 'success' },
  MODERATOR_REJECTED: { label: 'Отклонено модератором', tone: 'danger' },
  ADVERTISER_REJECTED: { label: 'Отклонено рекламодателем', tone: 'danger' },
};

// computed — значение, которое пересчитывается само, когда меняются props.
const steps = computed(() => STEPS[props.submission.status]);
const status = computed(() => STATUS[props.submission.status]);
const rejected = computed(() => steps.value === 0);
const canResubmit = computed(
  () => rejected.value && props.submission.order.status === 'OPEN',
);

const resubmitting = ref(false);
const error = ref('');

/** Новая попытка: откликаемся на тот же заказ заново и сразу идём отправлять видео — как в боте. */
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
      <span class="price">{{ formatPrice(submission.order.price) }}</span>
    </div>

    <div v-if="!rejected" class="steps" aria-hidden="true">
      <span v-for="n in 4" :key="n" :class="{ done: n <= steps }" />
    </div>

    <div class="status">
      <span :class="['label', status.tone]">{{ status.label }}</span>
      <span v-if="submission.status === 'IN_PROGRESS' && submission.order.deadline" class="hint">
        сдать до {{ formatDate(submission.order.deadline) }}
      </span>
      <span v-else-if="submission.attempt > 1" class="hint">попытка {{ submission.attempt }}</span>
    </div>

    <p v-if="submission.comment" class="comment">«{{ submission.comment }}»</p>

    <RouterLink
      v-if="submission.status === 'IN_PROGRESS'"
      :to="`/submissions/${submission.id}/video`"
      class="action"
    >
      Отправить видео
    </RouterLink>
    <button v-else-if="canResubmit" type="button" class="action" :disabled="resubmitting" @click="resubmit">
      {{ resubmitting ? 'Секунду…' : 'Отправить новую работу' }}
    </button>
    <p v-else-if="rejected" class="hint">Заказ закрыт — новые работы по нему не принимаются.</p>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
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
