<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, type Balance, fetchBalance, fetchRate, requestPayout } from '../api';
import SupportLink from '../components/SupportLink.vue';
import { approxRub, formatDate, formatMoney } from '../format';

const STATUS: Record<Balance['payouts'][number]['status'], { label: string; tone: string }> = {
  REQUESTED: { label: 'Ждёт перевода', tone: 'warn' },
  PAID: { label: 'Выплачено', tone: 'success' },
  REJECTED: { label: 'Отклонено', tone: 'danger' },
};

const balance = ref<Balance>();
const loadError = ref('');
// '' — поле пустое; v-model.number отдаёт '' для пустого ввода.
const amount = ref<number | ''>('');
const busy = ref(false);
const error = ref('');
const sent = ref(false);
// курс — только подсказка «≈ … ₽», не загрузился — не показываем
const rubPerUsdt = ref<number | null>(null);
void fetchRate().then((r) => (rubPerUsdt.value = r));

async function load() {
  try {
    balance.value = await fetchBalance();
    // выводим целые USDT, без центов
    amount.value = Math.floor(balance.value.available) || '';
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить баланс';
  }
}

async function withdraw() {
  busy.value = true;
  error.value = '';
  try {
    await requestPayout(Number(amount.value));
    sent.value = true;
    await load();
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
    <h1>Баланс</h1>

    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!balance" class="hint">Загрузка…</p>

    <template v-else>
      <section class="total">
        <span class="hint">Доступно к выводу</span>
        <strong>{{ formatMoney(balance.available) }}</strong>
        <span class="hint">
          Начислено {{ formatMoney(balance.earned) }} · выплачено {{ formatMoney(balance.paid) }}
          <template v-if="balance.requested"> · в заявке {{ formatMoney(balance.requested) }}</template>
        </span>
        <span v-if="rubPerUsdt" class="hint">
          {{ approxRub(balance.available, rubPerUsdt) }} · курс {{ rubPerUsdt.toLocaleString('ru-RU') }} ₽ за USDT
        </span>
      </section>

      <p v-if="sent" class="notice" role="status">
        Заявка отправлена. Менеджер переведёт USDT на ваш кошелёк — придёт уведомление.
      </p>
      <p v-else-if="balance.requested" class="hint">
        Заявка на {{ formatMoney(balance.requested) }} ждёт перевода. Новую можно отправить после неё.
      </p>
      <p v-else-if="!balance.wallet" class="notice ask">
        Укажите кошелёк USDT (TRC20) — на него придёт выплата.
        <RouterLink to="/profile">Добавить в профиле</RouterLink>
      </p>
      <form v-else-if="balance.available >= balance.minPayout" class="withdraw" @submit.prevent="withdraw">
        <label for="amount" class="section-title">Сумма вывода, USDT</label>
        <input
          id="amount"
          v-model.number="amount"
          type="number"
          inputmode="numeric"
          :min="balance.minPayout"
          :max="Math.floor(balance.available)"
          step="1"
          required
        />
        <p class="hint">
          Менеджер переведёт USDT в сети TRC20 на кошелёк {{ balance.wallet }}. Сменить его можно в профиле.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" class="main-button" :disabled="busy || !amount">
          {{ busy ? 'Отправляем…' : 'Вывести' }}
        </button>
      </form>
      <p v-else class="hint">Вывести можно от {{ formatMoney(balance.minPayout) }}.</p>

      <template v-if="balance.payouts.length">
        <h2 class="section-title flush">История выплат</h2>
        <article v-for="p in balance.payouts" :key="p.id" class="payout">
          <div class="row">
            <strong>{{ formatMoney(p.amount) }}</strong>
            <span :class="['badge', STATUS[p.status].tone]">{{ STATUS[p.status].label }}</span>
          </div>
          <span class="hint">{{ formatDate(p.createdAt) }}</span>
          <p v-if="p.comment" class="hint">Причина: «{{ p.comment }}»</p>
        </article>
      </template>

      <p class="hint">Начисления по каждому ролику — в «Мои отклики».</p>
      <SupportLink label="Вопрос по выплате — написать менеджеру" about="Вопрос по выплате" />
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
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 14px;
  background: var(--surface);
}
.total strong {
  font-size: 32px;
  font-weight: 700;
}
.notice {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--success-soft);
  font-size: 15px;
}
.notice.ask {
  background: var(--accent-soft);
}
.notice a {
  color: var(--link);
  font-weight: 600;
}
.withdraw .hint {
  overflow-wrap: anywhere;
}
.withdraw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.withdraw input {
  min-height: 50px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 17px;
}
.withdraw input:focus {
  outline: none;
  border-color: var(--accent);
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.flush {
  padding: 0;
}
.payout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.badge {
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}
.badge.warn {
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
}
.badge.success {
  background: var(--success-soft);
  color: #1e7b34;
}
.badge.danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
</style>
