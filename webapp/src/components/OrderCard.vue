<script setup lang="ts">
import { categoryLabel, type OrderSummary } from '../api';

// Входные параметры компонента: <OrderCard :order="o" /> в App.vue передаёт сюда заказ.
defineProps<{ order: OrderSummary }>();

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU');
}
</script>

<template>
  <!-- {{ }} экранирует HTML сам, поэтому текст от пользователей безопасен. Не использовать v-html. -->
  <article class="card">
    <h2>{{ order.title }}</h2>
    <p class="desc">{{ order.description }}</p>
    <div class="meta">
      <span>{{ categoryLabel(order.category) }}</span>
      <span v-if="order.price">💰 {{ order.price }}</span>
      <span v-if="order.deadline">⏰ до {{ formatDate(order.deadline) }}</span>
    </div>
  </article>
</template>

<style scoped>
.card {
  background: var(--tg-theme-section-bg-color, #fff);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
}
h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
.desc {
  margin: 0 0 8px;
  white-space: pre-line;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--tg-theme-hint-color, #999);
}
</style>
