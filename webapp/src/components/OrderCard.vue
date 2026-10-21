<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { categoryLabel, PLATFORM_NAMES, type OrderSummary } from '../api';
import { budgetViews, formatDate, formatMoney, formatViews, timeAgo } from '../format';
import PlatformIcon from './PlatformIcon.vue';

// Входные параметры компонента: <OrderCard :order="o" /> в CatalogView передаёт сюда заказ.
// preview — та же карточка, но не ссылка: предпросмотр в форме заказа, заказа ещё нет.
defineProps<{ order: OrderSummary; preview?: boolean }>();
</script>

<template>
  <!-- {{ }} экранирует HTML сам, поэтому текст от пользователей безопасен. Не использовать v-html. -->
  <component :is="preview ? 'div' : RouterLink" :to="preview ? undefined : `/orders/${order.id}`" class="card">
    <div class="top">
      <div class="tags">
        <span v-for="p in order.platforms" :key="p" class="tag platform">
          <PlatformIcon :platform="p" :size="18" round />
          {{ PLATFORM_NAMES[p] }}
        </span>
        <span v-if="!order.platforms.length" class="tag">{{ $t('orderCard.anyPlatform') }}</span>
        <span class="tag">{{ categoryLabel(order.category) }}</span>
      </div>
      <span v-if="order.deadline" class="deadline">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {{ $t('orderCard.until', { date: formatDate(order.deadline) }) }}
      </span>
      <span v-else class="ago">{{ timeAgo(order.createdAt) }}</span>
    </div>

    <div class="text">
      <div class="title">{{ order.title }}</div>
      <div class="desc">{{ order.description }}</div>
    </div>

    <!-- лайм — деньги: ставка плашкой с тёмным текстом читается в обеих темах -->
    <div v-if="order.cpm !== null" class="price">
      <span class="money cpm">{{ formatMoney(order.cpm) }}</span>
      <span class="per">{{ $t('money.perThousand') }}</span>
    </div>
    <span v-else class="per">{{ $t('money.cpmPending') }}</span>

    <div class="meta">
      <span :class="['free', { low: order.budgetLow }]">
        {{ $t('orderCard.left', { amount: formatMoney(order.free) }) }}<template v-if="order.cpm"> · {{ $t('orderCard.approxViews', { views: formatViews(budgetViews(order.free, order.cpm)) }) }}</template><template v-if="order.budgetLow">{{ $t('orderCard.hurry') }}</template>
      </span>
      <span>{{ $t('orderCard.minViews', { views: formatViews(order.minViews) }) }}</span>
    </div>
  </component>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  background: var(--fill);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.tag.platform {
  padding-left: 4px;
  font-weight: 700;
}
.deadline,
.ago {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--hint);
  white-space: nowrap;
}
.deadline {
  color: var(--orange-text);
}
.text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title {
  font-size: 18px;
  font-weight: 800;
  line-height: 1.25;
}
.desc {
  font-size: 14px;
  line-height: 1.45;
  color: var(--hint);
  /* Не больше двух строк описания в списке — полное в карточке заказа. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.price {
  align-self: flex-start;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--lime);
  color: var(--lime-text);
}
.cpm {
  font-size: 20px;
}
.price .per {
  color: var(--lime-text);
}
.per {
  font-size: 12px;
  font-weight: 600;
  color: var(--hint);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--hint);
}
.free.low {
  color: var(--orange-text);
  font-weight: 800;
}
</style>
