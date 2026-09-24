<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  fetchOpenOrders,
  ORDER_CATEGORIES,
  type OrderCategory,
  type OrderSummary,
} from './api';
import OrderCard from './components/OrderCard.vue';

// ref() — реактивное значение: поменяли `.value` в коде, и шаблон ниже перерисовался сам.
const category = ref<OrderCategory>();
const orders = ref<OrderSummary[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const error = ref('');

let lastRequest = 0;

/** reset — новая категория (с первой страницы); иначе дозагрузка следующей страницы. */
async function load(reset: boolean) {
  // Быстро переключили категорию дважды — ответ на старый запрос может прийти позже
  // нового и затереть список. Применяем только ответ на последний запрос.
  const requestId = ++lastRequest;
  const nextPage = reset ? 0 : page.value + 1;
  loading.value = true;
  error.value = '';
  try {
    const res = await fetchOpenOrders(nextPage, category.value);
    if (requestId !== lastRequest) return;
    orders.value = reset ? res.items : [...orders.value, ...res.items];
    total.value = res.total;
    page.value = nextPage;
  } catch {
    if (requestId === lastRequest) error.value = 'Не удалось загрузить заказы';
  } finally {
    if (requestId === lastRequest) loading.value = false;
  }
}

// Сменилась категория — грузим заново; immediate — и сразу при открытии экрана.
watch(category, () => load(true), { immediate: true });
</script>

<template>
  <main class="catalog">
    <h1>Доступные заказы</h1>

    <nav class="chips">
      <button :class="{ active: !category }" @click="category = undefined">
        🔎 Все
      </button>
      <button
        v-for="c in ORDER_CATEGORIES"
        :key="c.code"
        :class="{ active: category === c.code }"
        @click="category = c.code"
      >
        {{ c.label }}
      </button>
    </nav>

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!loading && orders.length === 0" class="hint">
      Заказов в этой категории пока нет.
    </p>

    <OrderCard v-for="o in orders" :key="o.id" :order="o" />

    <button
      v-if="orders.length < total"
      class="more"
      :disabled="loading"
      @click="load(false)"
    >
      {{ loading ? 'Загрузка…' : 'Показать ещё' }}
    </button>
  </main>
</template>

<style scoped>
.catalog {
  padding: 16px;
}
h1 {
  font-size: 20px;
  margin: 0 0 12px;
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 12px;
}
.chips button {
  flex: none;
  border: none;
  border-radius: 16px;
  padding: 6px 12px;
  background: var(--tg-theme-secondary-bg-color, #f1f1f4);
  color: var(--tg-theme-text-color, #000);
}
.chips button.active {
  background: var(--tg-theme-button-color, #2481cc);
  color: var(--tg-theme-button-text-color, #fff);
}
.hint {
  color: var(--tg-theme-hint-color, #999);
}
.more {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: var(--tg-theme-button-color, #2481cc);
  color: var(--tg-theme-button-text-color, #fff);
}
</style>
