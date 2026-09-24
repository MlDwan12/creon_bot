<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { categoryLabel, type OrderSummary } from '../api';
import { formatDate, formatPrice, timeAgo } from '../format';

// Входные параметры компонента: <OrderCard :order="o" /> в CatalogView передаёт сюда заказ.
defineProps<{ order: OrderSummary }>();
</script>

<template>
  <!-- {{ }} экранирует HTML сам, поэтому текст от пользователей безопасен. Не использовать v-html. -->
  <RouterLink :to="`/orders/${order.id}`" class="card">
    <div class="top">
      <span class="category">{{ categoryLabel(order.category) }}</span>
      <span class="price" :class="{ muted: !order.price }">{{ formatPrice(order.price) }}</span>
    </div>
    <div class="title">{{ order.title }}</div>
    <div class="desc">{{ order.description }}</div>
    <div class="meta">
      <span v-if="order.deadline" class="deadline">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        до {{ formatDate(order.deadline) }}
      </span>
      <span>размещён {{ timeAgo(order.createdAt) }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.category {
  font-size: 13px;
  color: var(--hint);
}
.price {
  font-size: 17px;
  font-weight: 700;
}
.price.muted {
  font-size: 15px;
  font-weight: 600;
  color: var(--hint);
}
.title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.desc {
  font-size: 15px;
  line-height: 1.4;
  color: var(--hint);
  /* Не больше двух строк описания в списке — полное в карточке заказа. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  color: var(--hint);
}
.deadline {
  display: flex;
  align-items: center;
  gap: 5px;
}
</style>
