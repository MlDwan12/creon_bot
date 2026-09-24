<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchAllOrders, type ModOrderRow } from '../../api';
import { formatPrice, timeAgo } from '../../format';

const STATUS: Record<ModOrderRow['status'], { label: string; tone: string }> = {
  PENDING_MODERATION: { label: 'На проверке', tone: 'warn' },
  OPEN: { label: 'Открыт', tone: 'success' },
  REJECTED: { label: 'Отклонён', tone: 'danger' },
  CLOSED: { label: 'Закрыт', tone: 'muted' },
};

const orders = ref<ModOrderRow[]>([]);
const total = ref(0);
const page = ref(-1);
const loading = ref(false);
const error = ref('');

async function loadMore() {
  loading.value = true;
  try {
    const res = await fetchAllOrders(page.value + 1);
    orders.value.push(...res.items);
    total.value = res.total;
    page.value += 1;
  } catch {
    error.value = 'Не удалось загрузить заказы';
  } finally {
    loading.value = false;
  }
}

void loadMore();
</script>

<template>
  <main class="page">
    <h1>Все заказы</h1>
    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!loading && orders.length === 0" class="hint">Заказов пока нет.</p>

    <div v-if="orders.length" class="list">
      <RouterLink v-for="o in orders" :key="o.id" :to="`/mod/orders/${o.id}`" class="row">
        <span class="main">
          <span class="title">{{ o.title }}</span>
          <span class="sub">
            {{ o.advertiser }} · {{ formatPrice(o.price) }} · откликов: {{ o.submissionsCount }} · {{ timeAgo(o.createdAt) }}
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
