<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

const route = useRoute();
/** У модератора свои вкладки — его окно отдельное. */
const moderator = computed(() => route.path.startsWith('/mod'));
</script>

<template>
  <nav class="tabbar" :aria-label="$t('tabs.aria')">
    <!-- RouterLink — ссылка, которая переключает экран без перезагрузки страницы. -->
    <template v-if="moderator">
      <RouterLink to="/mod" class="tab" exact-active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        </svg>
        {{ $t('tabs.modQueue') }}
      </RouterLink>
      <RouterLink to="/mod/orders" class="tab" exact-active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
        {{ $t('tabs.modOrders') }}
      </RouterLink>
      <RouterLink to="/mod/stats" class="tab" exact-active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 20V11M10 20V5M16 20v-7M21 20H3" />
        </svg>
        {{ $t('tabs.modStats') }}
      </RouterLink>
    </template>

    <template v-else>
      <RouterLink to="/" class="tab" exact-active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
        {{ $t('tabs.orders') }}
      </RouterLink>
      <RouterLink to="/submissions" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.5v5l4.5-2.5z" />
        </svg>
        {{ $t('tabs.submissions') }}
      </RouterLink>
      <RouterLink to="/my-orders" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
        </svg>
        {{ $t('tabs.myOrders') }}
      </RouterLink>
      <RouterLink to="/learn" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
        </svg>
        {{ $t('tabs.learn') }}
      </RouterLink>
      <!-- баланс открывается из профиля — вкладка подсвечена и там -->
      <RouterLink to="/profile" class="tab" :class="{ active: route.path === '/balance' }" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
        {{ $t('tabs.profile') }}
      </RouterLink>
    </template>
  </nav>
</template>

<style scoped>
/* Плавающая тёмная плашка над краем экрана; активная вкладка — лаймовая «таблетка». */
.tabbar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: var(--safe-bottom);
  display: grid;
  /* 3 вкладки у модератора, 5 у остальных. */
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  padding: 6px;
  border-radius: 26px;
  background: var(--ink);
  box-shadow: 0 10px 30px rgb(23 20 31 / 25%);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 48px;
  border-radius: 20px;
  color: var(--ink-hint);
  font-size: 11px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.tab.active {
  background: var(--lime);
  color: var(--lime-text);
  font-weight: 800;
}
</style>
