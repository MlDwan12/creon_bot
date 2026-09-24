<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <nav class="tabbar" aria-label="Разделы">
    <!-- RouterLink — ссылка, которая переключает экран без перезагрузки страницы. -->
    <RouterLink to="/" class="tab" exact-active-class="active">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
      Заказы
    </RouterLink>
    <RouterLink to="/submissions" class="tab" active-class="active">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9.5v5l4.5-2.5z" />
      </svg>
      Мои отклики
    </RouterLink>
    <RouterLink to="/my-orders" class="tab" active-class="active">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
      </svg>
      Мои заказы
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 6px 0 var(--safe-bottom);
  background: var(--surface);
  border-top: 1px solid var(--separator);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 44px;
  color: var(--hint);
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
}
.tab.active {
  color: var(--accent);
  font-weight: 600;
}
</style>
