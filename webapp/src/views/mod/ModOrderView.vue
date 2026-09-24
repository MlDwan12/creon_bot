<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, categoryLabel, fetchModOrder, fetchModQueue, type ModOrder, moderateOrder } from '../../api';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { formatDate, formatPrice, waitingFor } from '../../format';

const props = defineProps<{ id: string }>();
const router = useRouter();

const PRESETS = [
  'Нечёткое задание — опишите, что именно снять',
  'Контакты в описании — общение идёт через бота',
  'Запрещённая тематика',
  'Некорректный бюджет',
];
const STATUS_LABELS: Record<ModOrder['status'], string> = {
  PENDING_MODERATION: 'На проверке',
  OPEN: 'Опубликован',
  REJECTED: 'Отклонён',
  CLOSED: 'Закрыт',
  EXPIRED: 'Срок вышел',
};

const order = ref<ModOrder>();
const loadError = ref('');
const comment = ref('');
const busy = ref(false);
const error = ref('');

async function load() {
  order.value = undefined;
  loadError.value = '';
  comment.value = '';
  try {
    order.value = await fetchModOrder(Number(props.id));
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить заказ';
  }
}

/** После решения — сразу следующий заказ из очереди; очередь пуста — назад к ней. */
async function goNext() {
  const next = (await fetchModQueue().catch(() => undefined))?.orders.find((o) => o.id !== Number(props.id));
  await router.replace(next ? `/mod/orders/${next.id}` : '/mod');
}

async function decide(decision: 'approve' | 'reject') {
  busy.value = true;
  error.value = '';
  try {
    await moderateOrder(Number(props.id), decision, decision === 'reject' ? comment.value : undefined);
    await goNext();
  } catch (err) {
    // Например, другой модератор успел раньше: «Этот заказ уже обработан».
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

// Тот же экран открывается для следующего заказа — перечитываем при смене id.
watch(() => props.id, load, { immediate: true });
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!order" class="hint">Загрузка…</p>

    <template v-else>
      <header class="head">
        <span :class="['badge', { pending: order.status === 'PENDING_MODERATION' }]">
          Заказ #{{ order.id }} · {{ STATUS_LABELS[order.status] }}
          <template v-if="order.status === 'PENDING_MODERATION'"> · ждёт {{ waitingFor(order.createdAt) }}</template>
        </span>
        <h1>{{ order.title }}</h1>
      </header>

      <section class="rows">
        <div class="row"><span>Рекламодатель</span><span>{{ order.advertiser }}</span></div>
        <div class="row">
          <span>Цена · срок</span>
          <span>{{ formatPrice(order.price) }}<template v-if="order.deadline"> · до {{ formatDate(order.deadline) }}</template></span>
        </div>
        <div class="row"><span>Категория</span><span>{{ categoryLabel(order.category) }}</span></div>
      </section>

      <div class="text">{{ order.description }}</div>

      <p v-if="order.moderatorComment" class="hint">Комментарий модератора: «{{ order.moderatorComment }}»</p>

      <template v-if="order.status === 'PENDING_MODERATION'">
        <ReasonPicker v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
          <button type="button" class="approve" :disabled="busy" @click="decide('approve')">Опубликовать</button>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.badge {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 8px;
  background: var(--fill);
  font-size: 13px;
  font-weight: 600;
}
.badge.pending {
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.rows {
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  font-size: 16px;
}
.row span:first-child {
  color: var(--hint);
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.text {
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--surface);
  font-size: 16px;
  line-height: 1.45;
  white-space: pre-line;
}
.hint {
  margin: 0;
  color: var(--hint);
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.bottom-bar.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.bottom-bar button {
  height: 50px;
  border: none;
  border-radius: 12px;
  font-size: 17px;
  font-weight: 600;
}
.bottom-bar button:disabled {
  opacity: 0.5;
}
.reject {
  background: var(--danger);
  color: #fff;
}
.approve {
  background: #1e7b34;
  color: #fff;
}
</style>
