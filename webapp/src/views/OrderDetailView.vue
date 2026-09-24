<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, categoryLabel, claimOrder, fetchOrder, type OrderDetail } from '../api';
import { formatDeadline, formatPrice } from '../format';

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
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить заказ';
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
    claimError.value = err instanceof ApiError ? err.userMessage : 'Не удалось откликнуться';
  } finally {
    claiming.value = false;
  }
}

void load();
</script>

<template>
  <main class="detail">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!order" class="hint">Загрузка…</p>

    <template v-else>
      <header class="head">
        <span class="category">{{ categoryLabel(order.category) }}</span>
        <h1>{{ order.title }}</h1>
      </header>

      <section class="rows">
        <div class="row">
          <span>Оплата</span>
          <strong>{{ formatPrice(order.price) }}</strong>
        </div>
        <div v-if="order.deadline" class="row">
          <span>Сдать до</span>
          <span class="value">{{ formatDeadline(order.deadline) }}</span>
        </div>
        <div class="row">
          <span>Расчёт</span>
          <span class="value">напрямую, вне бота</span>
        </div>
      </section>

      <section class="block">
        <h2 class="section-title">Задание</h2>
        <div class="text">{{ order.description }}</div>
      </section>

      <section class="block">
        <h2 class="section-title">Как это работает</h2>
        <ol class="steps">
          <li>Откликаетесь — заказ появляется в «Мои отклики»</li>
          <li>Снимаете видео и присылаете ссылку</li>
          <li>Модератор проверяет ролик</li>
          <li>Рекламодатель подтверждает работу</li>
        </ol>
      </section>

      <p v-if="justClaimed" class="notice success" role="status">
        Заказ взят в работу. Когда видео будет готово, отправьте его в «Мои отклики».
      </p>
      <p v-if="claimError" class="notice error" role="alert">{{ claimError }}</p>

      <div class="bottom-bar">
        <RouterLink v-if="order.claimed" to="/submissions" class="main-button">
          Мои отклики
        </RouterLink>
        <button v-else type="button" class="main-button" :disabled="claiming" @click="claim">
          {{ claiming ? 'Отправляем…' : 'Откликнуться' }}
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
.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.category {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--fill);
  font-size: 13px;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
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
