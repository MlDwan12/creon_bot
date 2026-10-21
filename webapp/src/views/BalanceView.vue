<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, type Balance, fetchBalance, fetchRate, requestPayout } from '../api';
import SupportLink from '../components/SupportLink.vue';
import { approxRub, formatDate, formatMoney } from '../format';
import { i18next, locale } from '../i18n';

/** Цвет метки заявки; текст — в словаре (balance.status). */
const TONE: Record<Balance['payouts'][number]['status'], string> = {
  REQUESTED: 'warn',
  PAID: 'success',
  REJECTED: 'danger',
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
    loadError.value = err instanceof ApiError ? err.userMessage : i18next.t('balance.loadError');
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
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('balance.error');
  } finally {
    busy.value = false;
  }
}

/** TXy7…6tQ — целиком адрес виден в профиле. */
function shortWallet(w: string) {
  return w.length > 14 ? `${w.slice(0, 4)}…${w.slice(-6)}` : w;
}

void load();
</script>

<template>
  <main class="page">
    <h1>{{ $t('balance.title') }}</h1>

    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!balance" class="hint">{{ $t('common.loading') }}</p>

    <template v-else>
      <!-- Две плашки: что можно вывести сейчас и что ещё в холде (HOLD_DAYS после одобрения). -->
      <div class="tiles">
        <section class="tile total">
          <span class="hint">{{ $t('balance.available') }}</span>
          <strong>{{ formatMoney(balance.available) }}</strong>
          <span v-if="rubPerUsdt" class="hint">
            {{ $t('balance.rate', { rub: approxRub(balance.available, rubPerUsdt), rate: rubPerUsdt.toLocaleString(locale()) }) }}
          </span>
        </section>
        <section class="tile held">
          <span class="hint">{{ $t('balance.held') }}</span>
          <strong>{{ formatMoney(balance.held) }}</strong>
          <span class="hint">
            {{
              balance.nextReleaseAt
                ? $t('balance.nextRelease', { date: formatDate(balance.nextReleaseAt) })
                : $t('balance.heldHint')
            }}
          </span>
        </section>
      </div>
      <p class="hint">
        {{ $t('balance.summary', { earned: formatMoney(balance.earned), paid: formatMoney(balance.paid) }) }}
        <template v-if="balance.requested">{{ $t('balance.inRequest', { amount: formatMoney(balance.requested) }) }}</template>
      </p>

      <p v-if="sent" class="notice" role="status">
        {{ $t('balance.sent') }}
      </p>
      <p v-else-if="balance.requested" class="hint">
        {{ $t('balance.pending', { amount: formatMoney(balance.requested) }) }}
      </p>
      <p v-else-if="!balance.wallet" class="notice ask">
        {{ $t('balance.needWallet') }}
        <RouterLink to="/profile">{{ $t('balance.addWallet') }}</RouterLink>
      </p>
      <form v-else-if="balance.available >= balance.minPayout" class="withdraw" @submit.prevent="withdraw">
        <label for="amount" class="section-title">{{ $t('balance.amount') }}</label>
        <div class="amount-row">
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
          <button type="button" class="all" @click="amount = Math.floor(balance.available)">{{ $t('balance.all') }}</button>
        </div>
        <div class="wallet-row">
          <span>
            <small>{{ $t('balance.wallet') }}</small>
            <strong>{{ shortWallet(balance.wallet) }}</strong>
          </span>
          <RouterLink to="/profile">{{ $t('balance.changeWallet') }}</RouterLink>
        </div>
        <p class="hint">{{ $t('balance.walletHint') }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" class="main-button" :disabled="busy || !amount">
          {{ busy ? $t('common.sending') : $t('balance.withdraw') }}
        </button>
      </form>
      <p v-else class="hint">{{ $t('balance.minPayout', { amount: formatMoney(balance.minPayout) }) }}</p>

      <template v-if="balance.payouts.length">
        <h2 class="section-title flush">{{ $t('balance.history') }}</h2>
        <article v-for="p in balance.payouts" :key="p.id" class="payout">
          <div class="row">
            <strong>{{ formatMoney(p.amount) }}</strong>
            <span :class="['badge', TONE[p.status]]">{{ $t(`balance.status.${p.status}`) }}</span>
          </div>
          <span class="hint">{{ formatDate(p.createdAt) }}</span>
          <p v-if="p.comment" class="hint">{{ $t('balance.reason', { reason: p.comment }) }}</p>
        </article>
      </template>

      <p class="hint">{{ $t('balance.perVideo') }}</p>
      <SupportLink :label="$t('balance.supportLabel')" :about="$t('balance.supportAbout')" />
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
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 16px;
  border-radius: 22px;
  background: var(--surface);
}
.tile strong {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
  overflow-wrap: anywhere;
}
.total {
  background: var(--ink);
  color: var(--ink-text);
}
.total .hint {
  color: var(--ink-hint);
}
.total strong {
  color: var(--lime);
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
.amount-row {
  display: flex;
  gap: 8px;
}
.amount-row input {
  flex: 1;
  min-width: 0;
}
.all {
  flex: none;
  min-height: 50px;
  padding: 0 18px;
  border: none;
  border-radius: 14px;
  background: var(--accent-soft);
  color: var(--link);
  font-weight: 800;
}
.wallet-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.wallet-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wallet-row small {
  color: var(--hint);
  font-size: 12px;
}
.wallet-row a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--link);
  font-weight: 700;
  text-decoration: none;
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
  background: var(--orange-soft);
  color: var(--orange-text);
}
.badge.success {
  background: var(--success-soft);
  color: var(--success-text);
}
.badge.danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
</style>
