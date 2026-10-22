<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchAllOrders, type ModOrderRow, type OrderStatus } from '../../api';
import { formatMoney, timeAgo } from '../../format';

const STATUS: Record<ModOrderRow['status'], { label: string; tone: string }> = {
  PENDING_MODERATION: { label: 'На проверке', tone: 'warn' },
  OPEN: { label: 'Открыт', tone: 'success' },
  REJECTED: { label: 'Отклонён', tone: 'danger' },
  CLOSED: { label: 'Закрыт', tone: 'muted' },
  EXPIRED: { label: 'Срок вышел', tone: 'muted' },
  EDIT_REJECTED: { label: 'Правки отклонены', tone: 'danger' },
};

/** Фильтр по статусу: «Закрыты» — и закрытые вручную, и по сроку; «Отклонены» — и правки. */
const FILTERS: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Все', statuses: [] },
  { label: 'На проверке', statuses: ['PENDING_MODERATION'] },
  { label: 'Опубликованы', statuses: ['OPEN'] },
  { label: 'Закрыты', statuses: ['CLOSED', 'EXPIRED'] },
  { label: 'Отклонены', statuses: ['REJECTED', 'EDIT_REJECTED'] },
];
// храним подпись, а не объект: ref оборачивает объект в прокси, и сравнение с FILTERS не сработает
const filterLabel = ref(FILTERS[0].label);
const filter = computed(() => FILTERS.find((f) => f.label === filterLabel.value)!);

const orders = ref<ModOrderRow[]>([]);
const total = ref(0);
const page = ref(-1);
const loading = ref(false);
const error = ref('');

let lastRequest = 0;
async function loadMore() {
  // сменили фильтр, пока грузилась страница, — старый ответ не подмешиваем
  const requestId = ++lastRequest;
  loading.value = true;
  try {
    const res = await fetchAllOrders(page.value + 1, filter.value.statuses);
    if (requestId !== lastRequest) return;
    orders.value.push(...res.items);
    total.value = res.total;
    page.value += 1;
  } catch {
    error.value = 'Не удалось загрузить заказы';
  } finally {
    loading.value = false;
  }
}

watch(
  filter,
  () => {
    orders.value = [];
    page.value = -1;
    error.value = '';
    void loadMore();
  },
  { immediate: true },
);
</script>

<template>
  <main class="page">
    <h1>Все заказы</h1>
    <div class="chips" role="radiogroup" aria-label="Статус">
      <button
        v-for="f in FILTERS"
        :key="f.label"
        type="button"
        role="radio"
        :aria-checked="filterLabel === f.label"
        @click="filterLabel = f.label"
      >
        {{ f.label }}
      </button>
    </div>
    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!loading && orders.length === 0" class="hint">
      {{ filter.statuses.length ? 'С таким статусом заказов нет.' : 'Заказов пока нет.' }}
    </p>

    <div v-if="orders.length" class="list">
      <RouterLink v-for="o in orders" :key="o.id" :to="`/mod/orders/${o.id}`" class="row">
        <span class="main">
          <span class="title">{{ o.title }}</span>
          <span class="sub">
            {{ o.advertiser }} · {{ 'бюджет ' + formatMoney(o.budget) }} · откликов: {{ o.submissionsCount }} · {{ timeAgo(o.createdAt) }}
          </span>
        </span>
        <span :class="['badge', STATUS[o.status].tone]">{{ STATUS[o.status].label }}</span>
      </RouterLink>
    </div>

    <button v-if="orders.length < total" type="button" class="more" :disabled="loading" @click="loadMore">
      {{ loading ? 'Загрузка…' : 'Показать ещё' }}
    </button>
  </main>
</template>

<style scoped>
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 0 16px;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 85%, transparent);
}
.chips button {
  flex: none;
  min-height: 44px;
  padding: 0 14px;
  border: 1.5px solid var(--separator);
  border-radius: 22px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.chips button[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.list {
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 14px;
  color: var(--text);
  text-decoration: none;
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-grow: 1;
  min-width: 0;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.sub {
  font-size: 13px;
  color: var(--hint);
}
.badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
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
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.badge.muted {
  background: var(--fill);
  color: var(--hint);
}
.more {
  min-height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 16px;
  font-weight: 600;
}
.hint {
  margin: 0;
  color: var(--hint);
}
</style>
