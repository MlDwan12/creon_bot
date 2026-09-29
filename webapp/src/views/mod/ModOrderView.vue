<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, categoryLabel, fetchModOrder, fetchModQueue, type ModOrder, moderateOrder } from '../../api';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { formatCpm, formatDate, formatRubles, formatVideoFormat, formatViews, waitingFor } from '../../format';
import { safeUrl } from '../../telegram';

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
/** Ставка креатору за 1000 просмотров, ₽; '' — ещё не введена. После правки — прежняя. */
const cpm = ref<number | ''>('');
/** Сколько просмотров оплатит фонд при этой ставке — чтобы ставка была разумной. */
const coveredViews = computed(() =>
  order.value && cpm.value ? Math.floor((order.value.pool / cpm.value) * 1000) : 0,
);

async function load() {
  order.value = undefined;
  loadError.value = '';
  comment.value = '';
  try {
    order.value = await fetchModOrder(Number(props.id));
    cpm.value = order.value.cpm ?? '';
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
    await moderateOrder(
      Number(props.id),
      decision,
      order.value!.version,
      decision === 'reject' ? { comment: comment.value } : { cpm: Number(cpm.value) },
    );
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
          <template v-if="order.status === 'PENDING_MODERATION'"> · ждёт {{ waitingFor(order.version) }}</template>
        </span>
        <h1>{{ order.title }}</h1>
      </header>

      <section class="rows">
        <div class="row"><span>Рекламодатель</span><span>{{ order.advertiser }}</span></div>
        <div class="row">
          <span>Бюджет</span>
          <span>{{ formatRubles(order.budget) }}, креаторам {{ formatRubles(order.pool) }} (комиссия {{ order.feePercent }}%)</span>
        </div>
        <div class="row"><span>Порог</span><span>от {{ formatViews(order.minViews) }} просмотров</span></div>
        <div v-if="order.cpm !== null" class="row"><span>Ставка</span><span>{{ formatCpm(order.cpm) }}</span></div>
        <div v-if="order.deadline" class="row"><span>Срок</span><span>до {{ formatDate(order.deadline) }}</span></div>
        <div class="row"><span>Категория</span><span>{{ categoryLabel(order.category) }}</span></div>
      </section>

      <div class="text">{{ order.description }}</div>
      <p v-if="formatVideoFormat(order)" class="reference">Ролик: {{ formatVideoFormat(order) }}</p>
      <p v-if="order.referenceUrl" class="reference">
        Референс:
        <a v-if="safeUrl(order.referenceUrl)" :href="safeUrl(order.referenceUrl)" target="_blank" rel="noopener noreferrer">{{ order.referenceUrl }}</a>
        <template v-else>{{ order.referenceUrl }}</template>
      </p>

      <div v-if="order.contacts.length" class="contacts" role="alert">
        <strong>⚠ Похоже на контакты для связи в обход площадки</strong>
        <span>{{ order.contacts.join(' · ') }}</span>
      </div>

      <p v-if="order.moderatorComment" class="hint">Комментарий модератора: «{{ order.moderatorComment }}»</p>

      <template v-if="order.status === 'PENDING_MODERATION'">
        <label class="cpm">
          <span class="section-title">Ставка креатору за 1000 просмотров, ₽</span>
          <input v-model.number="cpm" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="например, 100" />
          <span v-if="coveredViews" class="hint">
            Фонда хватит примерно на {{ formatViews(coveredViews) }} просмотров
          </span>
        </label>
        <ReasonPicker v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
          <button type="button" class="approve" :disabled="busy || !cpm" @click="decide('approve')">Опубликовать</button>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
.cpm {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cpm input {
  min-height: 48px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
.cpm input:focus {
  outline: none;
  border-color: var(--accent);
}
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
.contacts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
  font-size: 15px;
  overflow-wrap: anywhere;
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
.reference {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.reference a {
  color: var(--link);
}
</style>
