<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { type CreatorProfile, fetchMyOrders, fetchMyProfile, type MyOrder } from '../api';
import AppSettings from '../components/AppSettings.vue';
import SupportLink from '../components/SupportLink.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { formatViews } from '../format';

/**
 * Профиль в кабинете заказчика: сводка по его рекламе и настройки. Кошелёк, соцсети и отзывы —
 * креаторские, они в /profile.
 */
const profile = ref<CreatorProfile>();
const orders = ref<MyOrder[]>();
// всё второстепенное: не загрузилось — просто не показываем
void fetchMyProfile().then((p) => (profile.value = p), () => {});
void fetchMyOrders().then((o) => (orders.value = o), () => {});

const summary = computed(() => {
  const list = orders.value;
  if (!list?.length) return undefined;
  return {
    views: list.reduce((sum, o) => sum + o.views, 0),
    orders: list.length,
    approved: list.reduce((sum, o) => sum + o.approved, 0),
  };
});
</script>

<template>
  <main class="page">
    <header v-if="profile" class="head">
      <UserAvatar :user-id="profile.id" :name="profile.name" :size="64" />
      <div class="who">
        <h1>{{ profile.name }}</h1>
        <span class="hint">{{ $t('account.subtitle') }}</span>
      </div>
    </header>

    <RouterLink v-if="summary" to="/my-orders" class="summary">
      <span class="money views">{{ formatViews(summary.views) }}</span>
      <span class="hint">{{ $t('account.views') }}</span>
      <span class="kpis">
        <span><b>{{ summary.orders }}</b>{{ $t('account.orders', { count: summary.orders }) }}</span>
        <span><b>{{ summary.approved }}</b>{{ $t('account.approved', { count: summary.approved }) }}</span>
      </span>
    </RouterLink>

    <AppSettings />

    <div class="links">
      <SupportLink />
      <RouterLink to="/privacy" class="quiet-link">{{ $t('catalog.privacy') }}</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.who h1 {
  margin: 0;
  font-size: 22px;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--hint);
  font-size: 14px;
}
.summary {
  display: flex;
  flex-direction: column;
  padding: 18px 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.views {
  font-size: 30px;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--separator);
  color: var(--hint);
  font-size: 13px;
}
.kpis b {
  display: block;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 18px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
