<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchMyOrders, type MyOrder } from '../api';
import MyOrderCard from '../components/MyOrderCard.vue';

const orders = ref<MyOrder[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  try {
    orders.value = await fetchMyOrders();
    error.value = '';
  } catch {
    error.value = 'Не удалось загрузить заказы';
  } finally {
    loading.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>Мои заказы</h1>
      <RouterLink to="/my-orders/new" class="new">+ Разместить</RouterLink>
    </header>

    <p v-if="loading" class="hint">Загрузка…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="orders.length === 0" class="hint">
      У вас пока нет заказов. Разместите первый — креаторы увидят его после проверки модератором.
    </p>

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
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.new {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
.hint {
  margin: 0;
  line-height: 1.4;
  color: var(--hint);
}
</style>
