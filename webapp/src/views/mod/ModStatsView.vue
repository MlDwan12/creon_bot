<script setup lang="ts">
import { ref } from 'vue';
import { fetchModStats, type ModStats } from '../../api';

const stats = ref<ModStats>();
const error = ref('');

fetchModStats()
  .then((s) => (stats.value = s))
  .catch(() => (error.value = 'Не удалось загрузить статистику'));
</script>

<template>
  <main class="page">
    <h1>Статистика</h1>
    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!stats" class="hint">Загрузка…</p>

    <template v-else>
      <h2 class="section-title flush">Заказы · всего {{ stats.orders.total }}</h2>
      <div class="tiles">
        <div class="tile"><strong>{{ stats.orders.pending }}</strong><span>на проверке</span></div>
        <div class="tile"><strong>{{ stats.orders.open }}</strong><span>открыто</span></div>
        <div class="tile"><strong>{{ stats.orders.rejected }}</strong><span>отклонено</span></div>
        <div class="tile"><strong>{{ stats.orders.closed }}</strong><span>закрыто</span></div>
      </div>

      <h2 class="section-title flush">Видео</h2>
      <div class="tiles three">
        <div class="tile"><strong>{{ stats.submissions.pending }}</strong><span>на модерации</span></div>
        <div class="tile"><strong>{{ stats.submissions.approved }}</strong><span>приняты</span></div>
        <div class="tile"><strong>{{ stats.submissions.rejected }}</strong><span>отклонены</span></div>
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
</style>
