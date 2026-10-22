<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ApiError,
  categoryLabel,
  fetchModOrder,
  fetchModQueue,
  type ModOrder,
  moderateOrder,
  type OrderSummary,
} from '../../api';
import OrderCard from '../../components/OrderCard.vue';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { formatCpm, formatDate, formatMoney, formatVideoFormat, formatViews, waitingFor } from '../../format';
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
  EDIT_REJECTED: 'Правки отклонены',
};

const order = ref<ModOrder>();
const loadError = ref('');
const comment = ref('');
const busy = ref(false);
const error = ref('');
/** Ставка креатору за 1000 просмотров, USDT; '' — ещё не введена. После правки — прежняя. */
const cpm = ref<number | ''>('');
/** Бюджет выше одобренного в прошлый раз — опубликовать можно, только отметив, что доплата получена. */
const budgetRaised = computed(
  () => !!order.value && order.value.approvedBudget !== null && order.value.budget > order.value.approvedBudget,
);
const paymentConfirmed = ref(false);
/** Сколько просмотров оплатит фонд при этой ставке — чтобы ставка была разумной. */
const coveredViews = computed(() =>
  order.value && cpm.value ? Math.floor((order.value.pool / cpm.value) * 1000) : 0,
);

/** Частые ставки, USDT за 1000 просмотров; другая — в поле ниже. */
const CPM_PRESETS = [1, 1.5, 2, 3];
/** Отказ в два шага: сначала «Отклонить», потом причина и подтверждение. */
const rejecting = ref(false);

/** Карточка в каталоге с выбранной ставкой — как её увидят креаторы после публикации. */
const previewCard = computed<OrderSummary>(() => {
  const o = order.value!;
  return {
    ...o,
    cpm: Number(cpm.value) || null,
    // как отдаёт API креаторам (freeForCreators): вниз до 100 USDT
    free: Math.floor(o.pool / 100) * 100,
    freeUnder: o.pool < 100 ? 100 : null,
    budgetLow: false,
  };
});

async function load() {
  rejecting.value = false;
  order.value = undefined;
  loadError.value = '';
  comment.value = '';
  paymentConfirmed.value = false;
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
      decision === 'reject'
        ? { comment: comment.value }
        : { cpm: Number(cpm.value), ...(budgetRaised.value && { budgetConfirmed: order.value!.budget }) },
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

      <!-- контакты — первым: из-за них заказ чаще всего отклоняют -->
      <div v-if="order.contacts.length" class="contacts" role="alert">
        <strong><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></svg> Похоже на контакты для связи в обход площадки</strong>
        <span>{{ order.contacts.join(' · ') }}</span>
      </div>

      <section class="rows">
        <div class="row"><span>Рекламодатель</span><span>{{ order.advertiser }}</span></div>
        <div class="row">
          <span>Бюджет</span>
          <span>
            <template v-if="budgetRaised">{{ formatMoney(order.approvedBudget!) }} → </template>
            {{ formatMoney(order.budget) }}, креаторам {{ formatMoney(order.pool) }} (комиссия {{ order.feePercent }}%)</span>
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
      <p v-if="order.targetUrl" class="reference">
        Товар:
        <a v-if="safeUrl(order.targetUrl)" :href="safeUrl(order.targetUrl)" target="_blank" rel="noopener noreferrer">{{ order.targetUrl }}</a>
        <template v-else>{{ order.targetUrl }}</template>
      </p>

      <label v-if="budgetRaised && order.status === 'PENDING_MODERATION'" class="contacts" role="alert">
        <strong><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></svg> Бюджет повышен на {{ formatMoney(order.budget - order.approvedBudget!) }}</strong>
        <span><input v-model="paymentConfirmed" type="checkbox" /> Доплата получена</span>
      </label>

      <p v-if="order.moderatorComment" class="hint">Комментарий модератора: «{{ order.moderatorComment }}»</p>

      <template v-if="order.status === 'PENDING_MODERATION'">
        <div class="cpm">
          <span id="cpm-label" class="section-title">Ставка креатору за 1000 просмотров, USDT</span>
          <div class="presets" role="radiogroup" aria-labelledby="cpm-label">
            <button
              v-for="v in CPM_PRESETS"
              :key="v"
              type="button"
              role="radio"
              :aria-checked="cpm === v"
              @click="cpm = v"
            >
              {{ v.toLocaleString('ru-RU') }}
            </button>
          </div>
          <input
            v-model.number="cpm"
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            placeholder="Другая ставка"
            aria-labelledby="cpm-label"
          />
          <span v-if="coveredViews" class="hint">
            Фонда хватит примерно на {{ formatViews(coveredViews) }} просмотров
          </span>
        </div>

        <section v-if="cpm" class="block">
          <h2 class="section-title">Так увидят креаторы</h2>
          <OrderCard :order="previewCard" preview />
        </section>

        <ReasonPicker v-if="rejecting" v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div v-if="rejecting" class="bottom-bar two">
          <button type="button" class="secondary" :disabled="busy" @click="rejecting = false">Отмена</button>
          <button type="button" class="reject-confirm" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
        </div>
        <div v-else class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy" @click="rejecting = true">Отклонить</button>
          <button type="button" class="approve" :disabled="busy || !cpm || (budgetRaised && !paymentConfirmed)" @click="decide('approve')">
            Опубликовать
          </button>
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
  background: var(--orange-soft);
  color: var(--orange-text);
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
  background: var(--orange-soft);
  color: var(--orange-text);
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
/* первый шаг отказа — спокойная кнопка, красная — только подтверждение с причиной */
.reject,
.secondary {
  background: var(--fill);
  color: var(--text);
}
.reject {
  color: var(--danger);
}
.reject-confirm {
  background: var(--danger);
  color: var(--accent-text);
}
.contacts strong {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.contacts .icon {
  flex: none;
  margin-top: 2px;
}
.presets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.presets button {
  min-height: 48px;
  border: 1.5px solid var(--separator);
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font-size: 15px;
  font-weight: 800;
}
.presets button[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.approve {
  background: var(--success);
  color: var(--accent-text);
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
