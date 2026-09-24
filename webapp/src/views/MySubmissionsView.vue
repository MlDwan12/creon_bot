<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchMySubmissions, type MySubmission } from '../api';
import SubmissionCard from '../components/SubmissionCard.vue';

const items = ref<MySubmission[]>([]);
const loading = ref(true);
const error = ref('');
const tab = ref<'active' | 'done'>('active');

const ACTIVE = ['IN_PROGRESS', 'SUBMITTED', 'MODERATOR_APPROVED'];

const active = computed(() => items.value.filter((s) => ACTIVE.includes(s.status)));
/** Отклонённые, по которым ещё можно прислать новую работу. */
const attention = computed(() =>
  items.value.filter(
    (s) =>
      (s.status === 'MODERATOR_REJECTED' || s.status === 'ADVERTISER_REJECTED') &&
      s.order.status === 'OPEN',
  ),
);
const done = computed(() =>
  items.value.filter((s) => !active.value.includes(s) && !attention.value.includes(s)),
);

async function load() {
  try {
    items.value = await fetchMySubmissions();
  } catch {
    error.value = 'Не удалось загрузить отклики';
  } finally {
    loading.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>Мои отклики</h1>

    <div class="segmented" role="tablist" aria-label="Фильтр откликов">
      <button type="button" role="tab" :aria-selected="tab === 'active'" @click="tab = 'active'">
        Активные · {{ active.length + attention.length }}
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'done'" @click="tab = 'done'">
        Завершённые · {{ done.length }}
      </button>
    </div>

    <p v-if="loading" class="hint">Загрузка…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="tab === 'active'">
      <p v-if="active.length + attention.length === 0" class="hint">
        Активных откликов нет.
        <RouterLink to="/">Выберите заказ в каталоге</RouterLink>
      </p>
      <SubmissionCard v-for="s in active" :key="s.id" :submission="s" />
      <template v-if="attention.length">
        <h2 class="section-title flush">Требуют внимания</h2>
        <SubmissionCard v-for="s in attention" :key="s.id" :submission="s" />
      </template>
    </template>

    <template v-else>
      <p v-if="done.length === 0" class="hint">Здесь появятся принятые и закрытые отклики.</p>
      <SubmissionCard v-for="s in done" :key="s.id" :submission="s" />
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
.flush {
  padding: 0;
}
.hint {
  margin: 0;
  color: var(--hint);
}
.hint a {
  color: var(--link);
}
</style>
