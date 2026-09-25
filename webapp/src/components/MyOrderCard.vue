<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, closeOrder, deleteOrder, extendOrder, type MyOrder } from '../api';
import { formatDate, formatPrice } from '../format';
import { confirmAction } from '../telegram';

const props = defineProps<{ order: MyOrder }>();
// emit — сообщить родителю (MyOrdersView), что список надо перезагрузить.
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();

const STATUS: Record<MyOrder['status'], { label: string; tone: string }> = {
  PENDING_MODERATION: { label: 'На проверке', tone: 'warn' },
  OPEN: { label: 'Открыт', tone: 'success' },
  REJECTED: { label: 'Отклонён', tone: 'danger' },
  CLOSED: { label: 'Закрыт', tone: 'muted' },
  EXPIRED: { label: 'Срок вышел', tone: 'muted' },
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
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

const close = () =>
  run('Закрыть заказ? Новые отклики перестанут приниматься.', () => closeOrder(props.order.id));
const extend = (days: number) =>
  run(null, async () => {
    await extendOrder(props.order.id, days);
    extending.value = false;
  });
const remove = () =>
  run('Удалить заказ? Это необратимо — вместе с ним удалятся все отклики.', () =>
    deleteOrder(props.order.id),
  );
</script>

<template>
  <article class="card">
    <div class="top">
      <div class="title">{{ order.title }}</div>
      <span :class="['badge', STATUS[order.status].tone]">{{ STATUS[order.status].label }}</span>
    </div>
    <div class="hint">
      {{ formatPrice(order.price) }}
      <template v-if="order.deadline"> · до {{ formatDate(order.deadline) }}</template>
      <template v-if="order.status === 'PENDING_MODERATION'"> · модератор проверит заказ перед публикацией</template>
    </div>

    <RouterLink v-if="order.pendingDecision > 0" :to="`/my-orders/${order.id}/review`" class="pending">
      <span>
        <strong>Видео ждут вашего решения: {{ order.pendingDecision }}</strong>
        <small>всего откликов: {{ order.submissionsCount }}</small>
      </span>
      <span aria-hidden="true">›</span>
    </RouterLink>
    <div v-else-if="order.submissionsCount > 0" class="hint">Откликов: {{ order.submissionsCount }}</div>

    <template v-if="order.status === 'REJECTED'">
      <p v-if="order.rejectReason" class="reason">Модератор: «{{ order.rejectReason }}»</p>
      <RouterLink :to="`/my-orders/new?from=${order.id}`" class="action">
        Исправить и отправить снова
      </RouterLink>
    </template>

    <p v-if="order.status === 'EXPIRED'" class="hint">
      Новые видео не принимаются. Продлите срок, чтобы снова открыть заказ.
    </p>

    <div v-if="extending" class="buttons">
      <button v-for="d in EXTEND_DAYS" :key="d" type="button" :disabled="busy" @click="extend(d)">
        +{{ d }} дн
      </button>
    </div>
    <div class="buttons">
      <button
        v-if="order.status === 'PENDING_MODERATION' || order.status === 'OPEN'"
        type="button"
        :disabled="busy"
        @click="router.push(`/my-orders/${order.id}/edit`)"
      >
        Изменить
      </button>
      <button v-if="canExtend" type="button" :disabled="busy" @click="extending = !extending">
        {{ extending ? 'Отмена' : 'Продлить срок' }}
      </button>
      <button v-if="order.status === 'OPEN'" type="button" :disabled="busy" @click="close">
        Закрыть набор
      </button>
      <button v-if="order.deletable" type="button" class="danger" :disabled="busy" @click="remove">Удалить</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.badge {
  flex: none;
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}
.badge.success {
  background: var(--success-soft);
  color: #1e7b34;
}
.badge.warn {
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
}
.badge.danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
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
  min-height: 48px;
  padding: 6px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, #9a5200 14%, transparent);
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
  gap: 8px;
}
.buttons button {
  flex: 1;
  min-height: 40px;
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
