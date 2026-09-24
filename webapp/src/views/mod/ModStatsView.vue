<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fetchModFunnel, fetchModStats, type ModFunnel, type ModStats } from '../../api';

const stats = ref<ModStats>();
const error = ref('');

fetchModStats()
  .then((s) => (stats.value = s))
  .catch(() => (error.value = 'Не удалось загрузить статистику'));

const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];
const period = ref<number | undefined>(30);
const funnel = ref<ModFunnel>();
const funnelError = ref('');

// Быстро переключили период — применяем только ответ на последний запрос.
let lastRequest = 0;
watch(
  period,
  async (days) => {
    const requestId = ++lastRequest;
    funnelError.value = '';
    try {
      const f = await fetchModFunnel(days);
      if (requestId === lastRequest) funnel.value = f;
    } catch {
      if (requestId === lastRequest) funnelError.value = 'Не удалось загрузить воронку';
    }
  },
  { immediate: true },
);

/** Этапы воронки заказов; процент — от созданных за период. */
const steps = computed(() => {
  const o = funnel.value?.orders;
  if (!o) return [];
  return [
    { label: 'Создано', value: o.created },
    { label: 'Опубликовано', value: o.published },
    { label: 'С откликами', value: o.withClaims },
    { label: 'С присланным видео', value: o.withVideos },
    { label: 'С принятым видео', value: o.withAccepted },
  ].map((step) => ({
    ...step,
    percent: o.created ? Math.round((step.value / o.created) * 100) : 0,
  }));
});

const rubles = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
</script>

<template>
  <main class="page">
    <h1>Статистика</h1>
    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!stats" class="hint">Загрузка…</p>

    <template v-else>
      <h2 class="section-title flush">Сейчас · заказов всего {{ stats.orders.total }}</h2>
      <div class="tiles">
        <div class="tile"><strong>{{ stats.orders.pending }}</strong><span>на проверке</span></div>
        <div class="tile"><strong>{{ stats.orders.open }}</strong><span>открыто</span></div>
        <div class="tile"><strong>{{ stats.orders.rejected }}</strong><span>отклонено</span></div>
        <div class="tile"><strong>{{ stats.orders.closed }}</strong><span>закрыто</span></div>
      </div>
      <div class="tiles three">
        <div class="tile"><strong>{{ stats.submissions.pending }}</strong><span>видео на модерации</span></div>
        <div class="tile"><strong>{{ stats.submissions.approved }}</strong><span>видео принято</span></div>
        <div class="tile"><strong>{{ stats.submissions.rejected }}</strong><span>видео отклонено</span></div>
      </div>
    </template>

    <div class="segmented" role="tablist" aria-label="Период воронки">
      <button
        v-for="p in PERIODS"
        :key="p.label"
        type="button"
        role="tab"
        :aria-selected="period === p.days"
        @click="period = p.days"
      >
        {{ p.label }}
      </button>
    </div>

    <p v-if="funnelError" class="hint">{{ funnelError }}</p>
    <template v-else-if="funnel">
      <h2 class="section-title flush">Воронка заказов</h2>
      <ol class="rows">
        <li v-for="s in steps" :key="s.label">
          <span>{{ s.label }}</span>
          <span><strong>{{ s.value }}</strong><small v-if="s.label !== 'Создано'"> · {{ s.percent }}%</small></span>
        </li>
      </ol>
      <p class="hint small">
        Отклонено модератором: {{ funnel.orders.rejected }}.
        Медиана модерации:
        {{ funnel.orders.moderationHours === null ? '—' : `${funnel.orders.moderationHours} ч` }}.
      </p>

      <h2 class="section-title flush">Видео · прислано {{ funnel.videos.submitted }}</h2>
      <div class="tiles">
        <div class="tile"><strong>{{ funnel.videos.accepted }}</strong><span>принято</span></div>
        <div class="tile"><strong>{{ funnel.videos.pending }}</strong><span>ждут решения</span></div>
        <div class="tile"><strong>{{ funnel.videos.moderatorRejected }}</strong><span>отклонил модератор</span></div>
        <div class="tile"><strong>{{ funnel.videos.advertiserRejected }}</strong><span>отклонил рекламодатель</span></div>
      </div>

      <h2 class="section-title flush">Пользователи</h2>
      <div class="tiles three">
        <div class="tile"><strong>{{ funnel.users.new }}</strong><span>новых</span></div>
        <div class="tile"><strong>{{ funnel.users.activeAdvertisers }}</strong><span>рекламодателей</span></div>
        <div class="tile"><strong>{{ funnel.users.activeCreators }}</strong><span>креаторов</span></div>
      </div>

      <h2 class="section-title flush">Оборот</h2>
      <div class="tile">
        <strong>{{ rubles(funnel.turnover.rubles) }}</strong>
        <span>цены принятых видео ({{ funnel.turnover.acceptedPriced }}), без договорных</span>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.flush {
  padding: 0;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.tiles.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.tile strong {
  font-size: 26px;
}
.tile span {
  font-size: 13px;
  color: var(--hint);
}
.hint {
  margin: 0;
  color: var(--hint);
}
.hint.small {
  font-size: 14px;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 8px;
  padding: 2px;
  border-radius: 9px;
  background: var(--fill);
}
.segmented button {
  min-height: 34px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font-size: 14px;
}
.segmented button[aria-selected='true'] {
  background: var(--surface);
  font-weight: 600;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  border-radius: 14px;
  background: var(--surface);
}
.rows li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  align-items: center;
  padding: 0 14px;
  font-size: 15px;
}
.rows li + li {
  border-top: 1px solid var(--separator);
}
.rows small {
  color: var(--hint);
  font-size: 14px;
}
</style>
