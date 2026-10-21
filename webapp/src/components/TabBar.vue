<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { fetchModPayouts, fetchModQueue, fetchModReports } from '../api';
import { role } from '../role';

const route = useRoute();
/** У модератора свои вкладки — его окно отдельное; у креатора и заказчика — свои (role.ts). */
const moderator = computed(() => route.path.startsWith('/mod'));

// Модератору — счётчики на вкладках: сколько ждёт в очереди и сколько заявок на вывод.
// Обновляем при переходах, но не чаще раза в 15 секунд.
const modCounts = ref<{ queue: number; payouts: number }>();
let countedAt = 0;
watch(
  () => route.path,
  async () => {
    if (!moderator.value || Date.now() - countedAt < 15_000) return;
    countedAt = Date.now();
    try {
      const [q, reports, payouts] = await Promise.all([fetchModQueue(), fetchModReports(), fetchModPayouts()]);
      modCounts.value = {
        queue: q.orders.length + q.videos.length + q.holds.length + q.reviews.length + reports.length,
        payouts: payouts.length,
      };
    } catch {
      // без счётчиков вкладки работают как обычно
    }
  },
  { immediate: true },
);
</script>

<template>
  <!-- Подложка до края экрана: под плавающей плашкой не просвечивает прокрученный контент. -->
  <div class="tabbar">
  <nav class="bar" :aria-label="$t('tabs.aria')">
    <!-- RouterLink — ссылка, которая переключает экран без перезагрузки страницы. -->
    <template v-if="moderator">
      <RouterLink to="/mod" class="tab" exact-active-class="active">
        <span v-if="modCounts?.queue" class="badge">{{ modCounts.queue }}</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
          <path d="M4 13h4.5l1 2.5h5l1-2.5H20" />
        </svg>
        {{ $t('tabs.modQueue') }}
      </RouterLink>
      <RouterLink to="/mod/payouts" class="tab" active-class="active">
        <span v-if="modCounts?.payouts" class="badge">{{ modCounts.payouts }}</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="6" width="18" height="13" rx="2.5" />
          <path d="M3 10.5h18M7 15h3" />
        </svg>
        {{ $t('tabs.modPayouts') }}
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

    <template v-else-if="role === 'advertiser'">
      <RouterLink to="/my-orders" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
        </svg>
        {{ $t('tabs.myOrders') }}
      </RouterLink>
      <RouterLink to="/help" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01" />
        </svg>
        {{ $t('tabs.help') }}
      </RouterLink>
      <RouterLink to="/account" class="tab" active-class="active">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
        {{ $t('tabs.profile') }}
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
  </div>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 12px var(--safe-bottom);
  background: linear-gradient(to bottom, transparent, var(--bg) 45%);
  /* прозрачный верх подложки не перехватывает касания */
  pointer-events: none;
}
/* Плавающая тёмная плашка над краем экрана; активная вкладка — лаймовая «таблетка». */
.bar {
  pointer-events: auto;
  display: grid;
  /* 3 вкладки у заказчика, 4 у креатора и модератора. */
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
  min-height: 52px;
  border-radius: 20px;
  color: var(--ink-hint);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.tab {
  position: relative;
}
/* счётчик модератору — оранжевый: «ждёт» во всём приложении оранжевое */
.badge {
  position: absolute;
  top: 4px;
  left: calc(50% + 6px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 9px;
  background: var(--orange);
  color: var(--lime-text);
  font-size: 11px;
  font-weight: 800;
  line-height: 18px;
  text-align: center;
}
.tab.active {
  background: var(--lime);
  color: var(--lime-text);
  font-weight: 800;
}
</style>
