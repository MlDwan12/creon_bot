<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { fetchModQueue, type ModQueue } from '../../api';
import { formatPrice, isWaitingLong, waitingFor } from '../../format';

const route = useRoute();
const router = useRouter();

// Вкладка — в адресе (?tab=videos), чтобы «Назад» из карточки вернул на ту же вкладку.
const tab = computed(() => (route.query.tab === 'videos' ? 'videos' : 'orders'));
const setTab = (t: 'orders' | 'videos') => router.replace({ query: t === 'videos' ? { tab: t } : {} });

const queue = ref<ModQueue>();
const error = ref('');

/** Самое старое ожидание в обеих очередях — главный сигнал «пора разбирать». */
const oldest = computed(() => {
  const dates = [
    ...(queue.value?.orders.map((o) => o.createdAt) ?? []),
    ...(queue.value?.videos.map((v) => v.submittedAt).filter((d): d is string => !!d) ?? []),
  ].sort();
  return dates[0];
});

async function load() {
  try {
    queue.value = await fetchModQueue();
  } catch {
    error.value = 'Не удалось загрузить очередь';
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>Модерация</h1>

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!queue" class="hint">Загрузка…</p>

    <template v-else>
      <div class="tiles">
        <div class="tile"><strong>{{ queue.orders.length }}</strong><span>заказов ждут</span></div>
        <div class="tile"><strong>{{ queue.videos.length }}</strong><span>видео ждут</span></div>
        <div class="tile" :class="{ warn: oldest && isWaitingLong(oldest) }">
          <strong>{{ oldest ? waitingFor(oldest) : '—' }}</strong><span>самое старое</span>
        </div>
      </div>

      <div class="segmented" role="tablist" aria-label="Очередь">
        <button type="button" role="tab" :aria-selected="tab === 'orders'" @click="setTab('orders')">
          Заказы · {{ queue.orders.length }}
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'videos'" @click="setTab('videos')">
          Видео · {{ queue.videos.length }}
        </button>
      </div>

      <p class="hint">Сначала самые старые</p>

      <div v-if="tab === 'orders'" class="list">
        <p v-if="queue.orders.length === 0" class="empty">Заказов на проверку нет.</p>
        <RouterLink v-for="o in queue.orders" :key="o.id" :to="`/mod/orders/${o.id}`" class="row">
          <span class="main">
            <span class="title">{{ o.title }}</span>
            <span class="sub">{{ o.advertiser }} · {{ formatPrice(o.price) }}</span>
          </span>
          <span :class="['wait', { long: isWaitingLong(o.createdAt) }]">{{ waitingFor(o.createdAt) }}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>
      </div>

      <div v-else class="list">
        <p v-if="queue.videos.length === 0" class="empty">Видео на проверку нет.</p>
        <RouterLink v-for="v in queue.videos" :key="v.id" :to="`/mod/videos/${v.id}`" class="row">
          <span class="main">
            <span class="title">{{ v.orderTitle }}</span>
            <span class="sub">{{ v.creator }}</span>
          </span>
          <span v-if="v.submittedAt" :class="['wait', { long: isWaitingLong(v.submittedAt) }]">
            {{ waitingFor(v.submittedAt) }}
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>
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
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface);
}
.tile strong {
  font-size: 24px;
}
.tile span {
  font-size: 13px;
  line-height: 1.25;
  color: var(--hint);
}
.tile.warn {
  background: color-mix(in srgb, #9a5200 14%, transparent);
}
.tile.warn strong,
.tile.warn span {
  color: #9a5200;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.list {
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 14px;
  color: var(--text);
  text-decoration: none;
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-grow: 1;
  min-width: 0;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.sub {
  font-size: 14px;
  color: var(--hint);
}
.wait {
  flex: none;
  font-size: 13px;
  color: var(--hint);
}
.wait.long {
  padding: 3px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
  font-weight: 600;
}
.chevron {
  color: var(--hint);
  font-size: 22px;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--hint);
}
.empty {
  margin: 0;
  padding: 16px;
  color: var(--hint);
}
</style>
