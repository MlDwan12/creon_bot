<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, categoryLabel, claimOrder, fetchOrder, PLATFORM_NAMES, type OrderDetail } from '../api';
import PlatformIcon from '../components/PlatformIcon.vue';
import { i18next, tList } from '../i18n';
import SupportLink from '../components/SupportLink.vue';
import { budgetViews, formatCompact, formatDeadline, formatMoney, formatViews, videoFormatParts } from '../format';
import { safeUrl } from '../telegram';

// `id` приходит из адреса /orders/:id (в router.ts у маршрута `props: true`).
const props = defineProps<{ id: string }>();

const order = ref<OrderDetail>();
const loadError = ref('');
const claiming = ref(false);
const claimError = ref('');
const justClaimed = ref(false);

async function load() {
  try {
    order.value = await fetchOrder(Number(props.id));
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : i18next.t('order.loadError');
  }
}

async function claim() {
  claiming.value = true;
  claimError.value = '';
  try {
    await claimOrder(Number(props.id));
    order.value!.claimed = true;
    justClaimed.value = true;
  } catch (err) {
    claimError.value = err instanceof ApiError ? err.userMessage : i18next.t('order.claimError');
  } finally {
    claiming.value = false;
  }
}

// Калькулятор: сколько принесёт ролик с таким числом просмотров — от порога заказа и выше.
const calcViews = ref<number>();
const presets = computed(() => {
  const min = order.value?.minViews ?? 0;
  return [...new Set([min, 1_000, 10_000, 50_000])].filter((v) => v >= min).sort((a, b) => a - b);
});
const views = computed(() => calcViews.value ?? presets.value[Math.min(2, presets.value.length - 1)]);
/** Выплата за просмотры по ставке, но не больше свободного остатка бюджета. */
const earning = computed(() => {
  const o = order.value;
  if (!o?.cpm || !views.value) return 0;
  return Math.min(o.free, Math.round(((views.value / 1000) * o.cpm) * 100) / 100);
});

void load();

// Остаток бюджета меняется, пока другие креаторы сдают ролики, — обновляем, пока экран открыт
// и виден. Сбой обновления не показываем: на экране остаются последние данные.
const refresh = setInterval(async () => {
  if (document.hidden || !order.value) return;
  order.value = await fetchOrder(Number(props.id)).catch(() => order.value);
}, 30_000);
onUnmounted(() => clearInterval(refresh));
</script>

<template>
  <main class="detail">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!order" class="hint">{{ $t('common.loading') }}</p>

    <template v-else>
      <!-- Главное о заказе — в одном ярком блоке: площадки, название, ставка, остаток. -->
      <header class="hero">
        <div class="tags">
          <span v-for="p in order.platforms" :key="p" class="tag platform">
            <PlatformIcon :platform="p" :size="18" round inverse />
            {{ PLATFORM_NAMES[p] }}
          </span>
          <span v-if="!order.platforms.length" class="tag">{{ $t('orderCard.anyPlatform') }}</span>
          <span class="tag">{{ categoryLabel(order.category) }}</span>
        </div>
        <h1>{{ order.title }}</h1>
        <div v-if="order.cpm !== null" class="price">
          <span class="money cpm">{{ formatMoney(order.cpm) }}</span>
          <span>{{ $t('money.perEveryThousand') }}</span>
        </div>
        <span v-else>{{ $t('order.cpmPending') }}</span>
        <span :class="['free', { low: order.budgetLow }]">
          {{ $t('order.left', { amount: formatMoney(order.free) })
          }}<template v-if="order.cpm"> · {{ $t('order.leftViews', { views: formatViews(budgetViews(order.free, order.cpm)) }) }}</template
          ><template v-if="order.budgetLow">{{ $t('orderCard.hurry') }}</template>
        </span>
      </header>

      <section v-if="order.cpm" class="calc" aria-labelledby="calc-title">
        <h2 id="calc-title">{{ $t('order.calcTitle') }}</h2>
        <div class="presets" role="radiogroup" :aria-label="$t('order.calcAria')">
          <button
            v-for="v in presets"
            :key="v"
            type="button"
            role="radio"
            :aria-checked="views === v"
            @click="calcViews = v"
          >
            {{ formatCompact(v) }}
          </button>
        </div>
        <div class="result">
          <span>{{ $t('order.calcViews', { views: formatViews(views) }) }}</span>
          <span class="money">{{ formatMoney(earning) }}</span>
        </div>
        <p class="note">{{ $t('order.calcNote', { views: formatViews(order.minViews) }) }}</p>
        <p class="note">{{ $t('order.budgetNote') }}</p>
      </section>

      <section class="rows">
        <div class="row">
          <span>{{ $t('order.canSubmit') }}</span>
          <span class="value">{{ $t('order.fromViews', { views: formatViews(order.minViews) }) }}</span>
        </div>
        <div v-if="order.deadline" class="row">
          <span>{{ $t('order.dueBy') }}</span>
          <span class="value">{{ formatDeadline(order.deadline) }}</span>
        </div>
        <div class="row">
          <span>{{ $t('order.payout') }}</span>
          <span class="value">{{ $t('order.payoutValue') }}</span>
        </div>
      </section>

      <section class="block">
        <h2 class="section-title">{{ $t('order.task') }}</h2>
        <div class="text">{{ order.description }}</div>
        <ul v-if="videoFormatParts(order).length" class="req" :aria-label="$t('order.requirements')">
          <li v-for="part in videoFormatParts(order)" :key="part">{{ part }}</li>
        </ul>
        <a v-if="safeUrl(order.referenceUrl)" :href="safeUrl(order.referenceUrl)" target="_blank" rel="noopener noreferrer" class="reference">
          {{ $t('order.reference') }}
        </a>
      </section>

      <section class="block">
        <h2 class="section-title">{{ $t('order.howItWorks') }}</h2>
        <ol class="steps">
          <li v-for="s in tList('order.steps')" :key="s">{{ s }}</li>
        </ol>
      </section>

      <RouterLink
        v-if="!order.own"
        :to="{ path: '/report', query: { target: 'ORDER', id: order.id, title: order.title } }"
        class="quiet-link"
      >
        {{ $t('order.report') }}
      </RouterLink>
      <SupportLink
        :label="$t('order.supportLabel', { id: order.id })"
        :about="$t('order.supportAbout', { id: order.id, title: order.title })"
      />

      <p v-if="justClaimed" class="notice success" role="status">
        {{ $t('order.claimed') }}
      </p>
      <p v-if="claimError" class="notice error" role="alert">{{ claimError }}</p>

      <p v-if="order.own" class="notice" role="status">{{ $t('order.own') }}</p>
      <div v-else class="bottom-bar">
        <RouterLink v-if="order.claimed" to="/submissions" class="main-button">
          {{ $t('order.mySubmissions') }}
        </RouterLink>
        <button v-else type="button" class="main-button" :disabled="claiming" @click="claim">
          {{ claiming ? $t('common.sending') : $t('order.claim') }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Снизу место под фиксированную нижнюю кнопку. */
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 26px;
  background: var(--accent);
  color: var(--accent-text);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  background: rgb(255 255 255 / 18%);
  font-size: 12px;
  font-weight: 700;
}
.tag.platform {
  padding-left: 4px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
}
.price {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0.9;
}
.cpm {
  font-size: 34px;
  letter-spacing: -1px;
}
.free {
  align-self: flex-start;
  padding: 6px 12px;
  border-radius: 10px;
  background: var(--lime);
  color: var(--lime-text);
  font-size: 14px;
  font-weight: 800;
}
.free.low {
  background: var(--orange);
}
.rows {
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 16px;
  font-size: 16px;
  color: var(--hint);
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.row strong {
  font-size: 17px;
  color: var(--text);
}
.row .value {
  color: var(--text);
  text-align: right;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.req {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.req li {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.calc {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
}
.calc h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
}
.presets {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 6px;
}
.presets button {
  min-height: 44px;
  border: 1.5px solid var(--separator);
  border-radius: 14px;
  background: none;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.presets button[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}
.result {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 14px;
  border-radius: 16px;
  background: var(--fill);
  color: var(--hint);
  font-size: 14px;
}
/* сумма — лаймовой плашкой, как все деньги: читается и в светлой теме */
.result .money {
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--lime);
  color: var(--lime-text);
  font-size: 20px;
}
.note {
  margin: 0;
  color: var(--hint);
  font-size: 13px;
  line-height: 1.45;
}
.reference {
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--link);
  font-size: 16px;
  text-decoration: none;
}
.text {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface);
  font-size: 16px;
  line-height: 1.45;
  white-space: pre-line;
}
.steps {
  margin: 0;
  padding: 14px 16px 14px 36px;
  border-radius: 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 15px;
  line-height: 1.35;
}
.notice {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.4;
}
.notice.success {
  background: var(--success-soft);
}
.notice.error {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.hint {
  margin: 0;
  color: var(--hint);
}
</style>
