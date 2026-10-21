<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchMyOrders, type MyOrder } from '../api';
import EmptyState from '../components/EmptyState.vue';
import MyOrderCard from '../components/MyOrderCard.vue';
import { i18next } from '../i18n';

const orders = ref<MyOrder[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  try {
    orders.value = await fetchMyOrders();
    error.value = '';
  } catch {
    error.value = i18next.t('myOrders.loadError');
  } finally {
    loading.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>{{ $t('myOrders.title') }}</h1>

    <p v-if="loading" class="hint">{{ $t('common.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <EmptyState v-else-if="orders.length === 0" :title="$t('myOrders.emptyTitle')" :text="$t('myOrders.empty')">
      <template #icon>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="2.5" />
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
        </svg>
      </template>
      <RouterLink to="/my-orders/new" class="main-button">{{ $t('myOrders.place') }}</RouterLink>
    </EmptyState>
    <!-- главное действие кабинета — крупно и первым, пока заказы есть -->
    <RouterLink v-if="orders.length" to="/my-orders/new" class="main-button place">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {{ $t('myOrders.place') }}
    </RouterLink>

    <!-- @changed — карточка сообщила, что заказ закрыт/удалён: перечитываем список. -->
    <MyOrderCard v-for="o in orders" :key="o.id" :order="o" @changed="load" />
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
  font-size: 26px;
  font-weight: 700;
}
.place {
  text-decoration: none;
}
.hint {
  margin: 0;
  line-height: 1.4;
  color: var(--hint);
}
</style>
