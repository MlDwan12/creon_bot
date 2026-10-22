<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  categoryLabel,
  fetchWhatWorks,
  PLATFORM_NAMES,
  type OrderCategory,
  type Platform,
  type WhatWorks,
  type WhatWorksRow,
  type WhatWorksSlice,
} from '../../api';

const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];
const period = ref<number | undefined>(30);
const data = ref<WhatWorks>();
const error = ref('');

// Быстро переключили период — применяем только ответ на последний запрос.
let lastRequest = 0;
watch(
  period,
  async (days) => {
    const requestId = ++lastRequest;
    error.value = '';
    try {
      const w = await fetchWhatWorks(days);
      if (requestId === lastRequest) data.value = w;
    } catch {
      if (requestId === lastRequest) error.value = 'Не удалось загрузить данные';
    }
  },
  { immediate: true },
);

const SLICES: { key: WhatWorksSlice; label: string }[] = [
  { key: 'category', label: 'Категория' },
  { key: 'platform', label: 'Площадка' },
  { key: 'orientation', label: 'Ориентация' },
  { key: 'duration', label: 'Длительность' },
  { key: 'cpm', label: 'Ставка' },
];
const slice = ref<WhatWorksSlice>('category');

const DURATION: Record<string, string> = {
  '15': 'до 15 с',
  '30': 'до 30 с',
  '60': 'до 60 с',
  LONG: 'больше 60 с',
};
const ORIENTATION: Record<string, string> = { VERTICAL: 'Вертикальная', HORIZONTAL: 'Горизонтальная' };

function label(s: WhatWorksSlice, key: string) {
  if (key === 'ANY') return 'Любая';
  if (s === 'category') return categoryLabel(key as OrderCategory);
  if (s === 'platform') return PLATFORM_NAMES[key as Platform] ?? key;
  if (s === 'orientation') return ORIENTATION[key] ?? key;
  if (s === 'duration') return DURATION[key] ?? key;
  return `$${key} за 1000`;
}

const enough = (r: WhatWorksRow) => r.orders >= (data.value?.minOrders ?? 0);
const percent = (n: number | null) => (n === null ? '—' : `${n}%`);
const views = (n: number | null) => (n === null ? '—' : n.toLocaleString('ru-RU'));

const METRICS: { key: 'avgViews' | 'takeRate' | 'approveRate'; title: string; show: (n: number | null) => string }[] = [
  { key: 'avgViews', title: 'Больше всего просмотров', show: views },
  { key: 'takeRate', title: 'Охотнее всего берут', show: percent },
  { key: 'approveRate', title: 'Чаще всего одобряют', show: percent },
];

/** Лучшее значение каждой метрики среди всех срезов, где хватает заказов. */
const highlights = computed(() => {
  const w = data.value;
  if (!w) return [];
  const rows = SLICES.flatMap((s) =>
    w.slices[s.key].filter((r) => enough(r) && r.key !== 'ANY').map((r) => ({ slice: s, row: r })),
  );
  return METRICS.flatMap((m) => {
    const best = rows
      .filter((x) => x.row[m.key] !== null)
      .sort((a, b) => (b.row[m.key] ?? 0) - (a.row[m.key] ?? 0))[0];
    return best
      ? [{ title: m.title, value: m.show(best.row[m.key]), what: `${best.slice.label} · ${label(best.slice.key, best.row.key)}` }]
      : [];
  });
});

const ACTIVITIES: { key: WhatWorks['audience'][number]['activity']; label: string }[] = [
  { key: 'both', label: 'Заказы и ролики' },
  { key: 'orders', label: 'Размещали заказы' },
  { key: 'videos', label: 'Сдавали ролики' },
  { key: 'none', label: 'Только смотрели' },
];
const CABINETS = ['CREATOR', 'ADVERTISER', null] as const;
const audienceCount = (activity: string, cabinet: (typeof CABINETS)[number]) =>
  data.value?.audience.find((a) => a.activity === activity && a.cabinet === cabinet)?.count ?? 0;
</script>

<template>
  <main class="page">
    <h1>Что работает</h1>

    <div class="segmented" role="tablist" aria-label="Период">
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

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!data" class="hint">Загрузка…</p>

    <template v-else>
      <template v-if="highlights.length">
        <h2 class="section-title flush">Главное</h2>
        <div class="tiles">
          <div v-for="h in highlights" :key="h.title" class="tile">
            <span>{{ h.title }}</span>
            <strong>{{ h.value }}</strong>
            <span>{{ h.what }}</span>
          </div>
        </div>
      </template>
      <p v-else class="hint small">
        Пока ни в одном срезе нет {{ data.minOrders }} опубликованных заказов — выводы делать рано.
      </p>

      <h2 class="section-title flush">Заказы по требованиям</h2>
      <div class="chips" role="radiogroup" aria-label="Срез">
        <button
          v-for="s in SLICES"
          :key="s.key"
          type="button"
          role="radio"
          :aria-checked="slice === s.key"
          @click="slice = s.key"
        >
          {{ s.label }}
        </button>
      </div>
      <p v-if="!data.slices[slice].length" class="hint">Опубликованных заказов за период нет.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th></th>
            <th>Заказов</th>
            <th>Берут</th>
            <th>Просмотры</th>
            <th>Одобряют</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.slices[slice]" :key="r.key" :class="{ dim: !enough(r) }">
            <th scope="row">
              {{ label(slice, r.key) }}
              <small v-if="!enough(r)">мало данных</small>
            </th>
            <td>{{ r.orders }}</td>
            <td>{{ percent(r.takeRate) }}</td>
            <td>{{ views(r.avgViews) }}</td>
            <td>{{ percent(r.approveRate) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="hint small">
        Берут — креаторов взяли заказ из открывших карточку. Просмотры — в среднем у одобренного ролика.
        Одобряют — из проверенных роликов. Длительность — по требованию заказа, а не по ролику.
        Заказ с несколькими площадками считается в каждой.
      </p>

      <h2 class="section-title flush">Аудитория · новые за период</h2>
      <table class="table">
        <thead>
          <tr>
            <th></th>
            <th>Креатор</th>
            <th>Заказчик</th>
            <th>Не выбрал</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in ACTIVITIES" :key="a.key">
            <th scope="row">{{ a.label }}</th>
            <td v-for="c in CABINETS" :key="String(c)">{{ audienceCount(a.key, c) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="hint small">Столбец — кабинет, открытый последним; строка — что человек делал на самом деле.</p>
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
.hint {
  margin: 0;
  color: var(--hint);
}
.hint.small {
  font-size: 13px;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 2px;
  border-radius: 9px;
  background: var(--fill);
}
.segmented button {
  min-height: 44px;
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
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
/* нечётная последняя плитка — во всю ширину, без дыры справа */
.tile:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.tile strong {
  font-size: 26px;
}
.tile span {
  font-size: 13px;
  color: var(--hint);
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 0 16px;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 85%, transparent);
}
.chips button {
  flex: none;
  min-height: 44px;
  padding: 0 14px;
  border: 1.5px solid var(--separator);
  border-radius: 22px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.chips button[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}
.table {
  width: 100%;
  border-collapse: collapse;
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.table th,
.table td {
  padding: 10px 6px;
  text-align: right;
}
.table th:first-child {
  padding-left: 14px;
  text-align: left;
  font-weight: 600;
}
.table :is(th, td):last-child {
  padding-right: 14px;
}
.table thead th {
  color: var(--hint);
  font-size: 12px;
  font-weight: 400;
}
.table tbody tr {
  border-top: 1px solid var(--separator);
}
.table th small {
  display: block;
  color: var(--hint);
  font-size: 12px;
  font-weight: 400;
}
.dim td,
.dim th {
  color: var(--hint);
}
</style>
