<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  fetchOpenOrders,
  ORDER_CATEGORIES,
  type OrderCategory,
  type OrderSummary,
} from '../api';
import { RouterLink } from 'vue-router';
import OrderCard from '../components/OrderCard.vue';
import SupportLink from '../components/SupportLink.vue';

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
    <header class="head">
      <h1>Заказы</h1>
      <p>Выберите задание, снимите видео и получите оплату</p>
    </header>

    <nav class="chips" aria-label="Категории">
      <button type="button" :aria-pressed="!category" @click="category = undefined">Все</button>
      <button
        v-for="c in ORDER_CATEGORIES"
        :key="c.code"
        type="button"
        :aria-pressed="category === c.code"
        @click="category = c.code"
      >
        {{ c.label }}
      </button>
    </nav>

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!loading && orders.length === 0" class="hint">
      Заказов в этой категории пока нет.
    </p>
    <h2 v-else-if="total > 0" class="section-title count">{{ total }} открытых заказов</h2>

    <OrderCard v-for="o in orders" :key="o.id" :order="o" />

    <button
      v-if="orders.length < total"
      type="button"
      class="more"
      :disabled="loading"
      @click="load(false)"
    >
      {{ loading ? 'Загрузка…' : 'Показать ещё' }}
    </button>

    <footer class="footer">
      <SupportLink />
      <RouterLink to="/privacy" class="quiet-link">Политика конфиденциальности</RouterLink>
    </footer>
  </main>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Снизу место под фиксированные вкладки. */
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head h1 {
  margin: 0 0 4px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.head p {
  margin: 0;
  font-size: 15px;
  color: var(--hint);
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 0 16px;
  scrollbar-width: none;
}
.chips button {
  flex: none;
  min-height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.chips button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.count {
  padding: 0;
}
.hint {
  margin: 0;
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
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}
</style>
