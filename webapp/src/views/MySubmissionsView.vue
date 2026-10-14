<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { type Balance, fetchBalance, fetchMySubmissions, type MySubmission } from '../api';
import { formatMoney } from '../format';
import { i18next } from '../i18n';
import SubmissionCard from '../components/SubmissionCard.vue';

const items = ref<MySubmission[]>([]);
const loading = ref(true);
const error = ref('');
const tab = ref<'active' | 'done'>('active');
const balance = ref<Balance>();
// баланс — второстепенное: не загрузился — просто не показываем
void fetchBalance().then((b) => (balance.value = b), () => {});

const ACTIVE = ['IN_PROGRESS', 'SUBMITTED', 'MODERATOR_APPROVED'];

const active = computed(() => items.value.filter((s) => ACTIVE.includes(s.status)));
/** Отклонённые и сгоревшие, по которым ещё можно прислать новую работу (только последнее видео по заказу). */
const attention = computed(() =>
  items.value.filter(
    (s) =>
      ['MODERATOR_REJECTED', 'ADVERTISER_REJECTED', 'SLOT_EXPIRED'].includes(s.status) &&
      s.latest &&
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
    error.value = i18next.t('submissions.loadError');
  } finally {
    loading.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>{{ $t('submissions.title') }}</h1>

    <RouterLink v-if="balance" to="/balance" class="balance">
      <span>
        <small>{{ $t('submissions.balance') }}</small>
        <strong>{{ formatMoney(balance.available) }}</strong>
      </span>
      <span class="balance-action">{{ $t('submissions.withdraw') }}</span>
    </RouterLink>

    <div class="segmented" role="tablist" :aria-label="$t('submissions.filterAria')">
      <button type="button" role="tab" :aria-selected="tab === 'active'" @click="tab = 'active'">
        {{ $t('submissions.active', { count: active.length + attention.length }) }}
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'done'" @click="tab = 'done'">
        {{ $t('submissions.done', { count: done.length }) }}
      </button>
    </div>

    <p v-if="loading" class="hint">{{ $t('common.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="tab === 'active'">
      <p v-if="active.length + attention.length === 0" class="hint">
        {{ $t('submissions.emptyActive') }}
        <RouterLink to="/">{{ $t('submissions.toCatalog') }}</RouterLink>
      </p>
      <SubmissionCard v-for="s in active" :key="s.id" :submission="s" />
      <template v-if="attention.length">
        <h2 class="section-title flush">{{ $t('submissions.attention') }}</h2>
        <SubmissionCard v-for="s in attention" :key="s.id" :submission="s" />
      </template>
    </template>

    <template v-else>
      <p v-if="done.length === 0" class="hint">{{ $t('submissions.emptyDone') }}</p>
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
/* Баланс — тёмная плашка с лаймовой суммой, как в макете. */
.balance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-radius: var(--radius-card);
  background: var(--ink);
  color: var(--ink-text);
  text-decoration: none;
}
.balance span:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.balance small {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-hint);
}
.balance strong {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--lime);
}
.balance-action {
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--lime);
  color: var(--lime-text);
  font-weight: 800;
}
.hint a {
  color: var(--link);
}
</style>
