<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, closeOrder, deleteOrder, extendOrder, type MyOrder } from '../api';
import { formatDate, formatMoney, formatViews } from '../format';
import { i18next } from '../i18n';
import { confirmAction } from '../telegram';

const props = defineProps<{ order: MyOrder }>();
// emit — сообщить родителю (MyOrdersView), что список надо перезагрузить.
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();

/** Цвет метки статуса; текст — в словаре (myOrderCard.status). */
const TONE: Record<MyOrder['status'], string> = {
  PENDING_MODERATION: 'warn',
  OPEN: 'success',
  REJECTED: 'danger',
  CLOSED: 'muted',
  EXPIRED: 'muted',
};

/** На сколько дней продлить — как варианты срока в форме заказа. */
const EXTEND_DAYS = [3, 7, 14, 30];

const busy = ref(false);
const error = ref('');

/** Продлить можно открытый заказ со сроком и заказ, закрытый по сроку. */
const canExtend = computed(
  () => props.order.status === 'EXPIRED' || (props.order.status === 'OPEN' && !!props.order.deadline),
);
const extending = ref(false);

async function run(question: string | null, action: () => Promise<unknown>) {
  if (question && !(await confirmAction(question))) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
    emit('changed');
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('myOrderCard.error');
  } finally {
    busy.value = false;
  }
}

const close = () =>
  run(i18next.t('myOrderCard.closeConfirm'), () =>
    closeOrder(props.order.id),
  );
const extend = (days: number) =>
  run(null, async () => {
    await extendOrder(props.order.id, days);
    extending.value = false;
  });
const remove = () =>
  run(i18next.t('myOrderCard.deleteConfirm'), () =>
    deleteOrder(props.order.id),
  );
</script>

<template>
  <article class="card">
    <div class="top">
      <div class="title">{{ order.title }}</div>
      <span :class="['badge', TONE[order.status]]">{{ $t(`myOrderCard.status.${order.status}`) }}</span>
    </div>
    <div class="hint">
      {{ $t('myOrderCard.budget', { amount: formatMoney(order.budget) })
      }}<template v-if="order.deadline">{{ $t('myOrderCard.until', { date: formatDate(order.deadline) }) }}</template
      ><template v-if="order.status === 'PENDING_MODERATION'">{{ $t('myOrderCard.pending') }}</template>
    </div>

    <div v-if="order.approved > 0 || order.usedPercent > 0" class="usage">
      <div class="bar" aria-hidden="true"><span :style="{ width: `${order.usedPercent}%` }" /></div>
      <div class="hint">
        {{ $t('myOrderCard.usage', { percent: order.usedPercent, approved: order.approved, views: formatViews(order.views) }) }}
      </div>
    </div>

    <RouterLink v-if="order.approved > 0" :to="`/my-orders/${order.id}/review`" class="pending">
      <span>
        <strong>{{ $t('myOrderCard.report', { count: order.approved }) }}</strong>
        <small v-if="order.toRate > 0">{{ $t('myOrderCard.toRate', { count: order.toRate }) }}</small>
        <small v-else>{{ $t('myOrderCard.totalSubmissions', { count: order.submissionsCount }) }}</small>
      </span>
      <span aria-hidden="true">›</span>
    </RouterLink>
    <div v-else-if="order.submissionsCount > 0" class="hint">{{ $t('myOrderCard.submissions', { count: order.submissionsCount }) }}</div>

    <template v-if="order.status === 'REJECTED'">
      <p v-if="order.rejectReason" class="reason">{{ $t('myOrderCard.moderator', { reason: order.rejectReason }) }}</p>
      <RouterLink :to="`/my-orders/new?from=${order.id}`" class="action">
        {{ $t('myOrderCard.fix') }}
      </RouterLink>
    </template>

    <p v-if="order.status === 'EXPIRED'" class="hint">
      {{ $t('myOrderCard.expired') }}
    </p>

    <div v-if="extending" class="buttons">
      <button v-for="d in EXTEND_DAYS" :key="d" type="button" :disabled="busy" @click="extend(d)">
        {{ $t('myOrderCard.extendBy', { count: d }) }}
      </button>
    </div>
    <div class="buttons">
      <button
        v-if="order.status === 'PENDING_MODERATION' || order.status === 'OPEN'"
        type="button"
        :disabled="busy"
        @click="router.push(`/my-orders/${order.id}/edit`)"
      >
        {{ $t('myOrderCard.edit') }}
      </button>
      <button v-if="canExtend" type="button" :disabled="busy" @click="extending = !extending">
        {{ extending ? $t('common.cancel') : $t('myOrderCard.extend') }}
      </button>
      <button v-if="order.status === 'OPEN'" type="button" :disabled="busy" @click="close">
        {{ $t('myOrderCard.close') }}
      </button>
      <!-- та же форма, что «Исправить и отправить снова»: поля подставятся из этого заказа -->
      <button
        v-if="order.status !== 'REJECTED' && order.status !== 'PENDING_MODERATION'"
        type="button"
        :disabled="busy"
        @click="router.push(`/my-orders/new?from=${order.id}`)"
      >
        {{ $t('myOrderCard.similar') }}
      </button>
      <button v-if="order.deletable" type="button" class="danger" :disabled="busy" @click="remove">{{ $t('myOrderCard.delete') }}</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.usage {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--fill);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
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
.badge {
  flex: none;
  align-self: flex-start;
  padding: 5px 10px;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 800;
}
.badge.success {
  background: var(--success-soft);
  color: var(--success-text);
}
.badge.warn {
  background: var(--orange-soft);
  color: var(--orange-text);
}
.badge.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.muted {
  background: var(--fill);
  color: var(--hint);
}
.hint {
  font-size: 14px;
  color: var(--hint);
}
.pending {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 52px;
  padding: 8px 14px;
  border-radius: 16px;
  background: var(--orange-soft);
  color: var(--text);
  text-decoration: none;
  font-size: 20px;
}
.pending span:first-child {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pending strong {
  font-size: 15px;
}
.pending small {
  font-size: 13px;
  color: var(--hint);
}
.reason {
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
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
}
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.buttons button {
  flex: 1 1 auto;
  min-height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  background: var(--fill);
  color: var(--text);
  font-size: 15px;
}
.buttons button.danger {
  color: var(--danger);
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
