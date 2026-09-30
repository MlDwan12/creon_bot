<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, decidePayout, fetchModPayouts, type ModPayout } from '../../api';
import { formatRubles, isWaitingLong, waitingFor } from '../../format';
import { confirmAction } from '../../telegram';

const items = ref<ModPayout[]>();
const loadError = ref('');
/** У какой заявки открыта форма отказа. */
const rejecting = ref<number>();
const comment = ref('');
const busy = ref(false);
const error = ref('');

async function load() {
  try {
    items.value = await fetchModPayouts();
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить заявки';
  }
}

async function decide(p: ModPayout, decision: 'paid' | 'reject') {
  if (decision === 'paid' && !(await confirmAction(`Отметить: ${formatRubles(p.amount)} переведены ${p.creator}?`))) return;
  busy.value = true;
  error.value = '';
  try {
    await decidePayout(p.id, decision, decision === 'reject' ? comment.value : undefined);
    items.value = items.value!.filter((i) => i.id !== p.id);
    rejecting.value = undefined;
    comment.value = '';
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>Заявки на вывод</h1>
    <p class="hint">
      Реквизиты креатор присылает в свою тему поддержки. Переведите деньги и отметьте заявку — креатору придёт уведомление.
    </p>

    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!items" class="hint">Загрузка…</p>
    <p v-else-if="items.length === 0" class="hint">Открытых заявок нет.</p>

    <article v-for="p in items" :key="p.id" class="item">
      <div class="row">
        <strong>{{ formatRubles(p.amount) }}</strong>
        <span :class="['wait', { long: isWaitingLong(p.createdAt) }]">{{ waitingFor(p.createdAt) }}</span>
      </div>
      <RouterLink :to="`/mod/creators/${p.creatorId}`" class="creator">{{ p.creator }} · заявка #{{ p.id }}</RouterLink>

      <template v-if="rejecting === p.id">
        <textarea v-model="comment" rows="2" maxlength="500" placeholder="Причина — её увидит креатор" />
        <div class="two">
          <button type="button" class="secondary" :disabled="busy" @click="rejecting = undefined">Отмена</button>
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide(p, 'reject')">
            Отклонить
          </button>
        </div>
      </template>
      <div v-else class="two">
        <button type="button" class="secondary" :disabled="busy" @click="rejecting = p.id">Отклонить</button>
        <button type="button" class="approve" :disabled="busy" @click="decide(p, 'paid')">Выплачено</button>
      </div>
    </article>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
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
  font-size: 24px;
  font-weight: 700;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.row strong {
  font-size: 20px;
}
.wait {
  font-size: 13px;
  color: var(--hint);
}
.wait.long {
  color: #9a5200;
  font-weight: 600;
}
.creator {
  color: var(--link);
  text-decoration: none;
}
textarea {
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.two button {
  height: 44px;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
}
.secondary {
  background: var(--fill);
  color: var(--text);
}
.approve {
  background: #1e7b34;
  color: #fff;
}
.reject {
  background: var(--danger);
  color: #fff;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
