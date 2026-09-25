<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, createOrder, fetchMyOrders, ORDER_CATEGORIES, type NewOrderInput } from '../api';

// Лимиты — те же, что проверяет бэкенд (src/common/validation.ts); здесь только подсказка браузеру.
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MAX_PRICE = 1_000_000;
const DEADLINES: { days: number | null; label: string }[] = [
  { days: 3, label: '3 дн' },
  { days: 7, label: '7 дн' },
  { days: 14, label: '14 дн' },
  { days: 30, label: '30 дн' },
  { days: null, label: 'нет' },
];

const route = useRoute();
const router = useRouter();

// reactive() — как ref(), но для объекта целиком: form.title и т.д. без `.value`.
// price: '' — поле пустое (цена договорная); v-model.number отдаёт '' для пустого ввода.
const form = reactive<Omit<NewOrderInput, 'price'> & { price: number | '' }>({
  title: '',
  description: '',
  price: '',
  category: 'OTHER',
  deadlineDays: 7,
});
const sending = ref(false);
const error = ref('');

/** «Исправить и отправить снова»: /my-orders/new?from=<id> — подставляем данные отклонённого заказа. */
async function prefill() {
  const fromId = Number(route.query.from);
  if (!fromId) return;
  const source = (await fetchMyOrders().catch(() => [])).find((o) => o.id === fromId);
  if (!source) return;
  form.title = source.title;
  form.description = source.description;
  form.price = source.price ?? '';
  form.category = source.category;
}

async function submit() {
  sending.value = true;
  error.value = '';
  try {
    await createOrder({ ...form, price: form.price === '' ? null : form.price });
    await router.replace('/my-orders');
  } catch (err) {
    // Тексты ошибок проверки пишет бэкенд.
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось отправить заказ';
  } finally {
    sending.value = false;
  }
}

void prefill();
</script>

<template>
  <main class="page">
    <h1>Новый заказ</h1>

    <form id="order-form" class="form" @submit.prevent="submit">
      <div class="field">
        <div class="label-row">
          <label for="title" class="section-title">Название</label>
          <span class="counter">{{ form.title.length }} / {{ MAX_TITLE }}</span>
        </div>
        <!-- v-model — двусторонняя связь: ввод в поле сразу попадает в form.title и обратно. -->
        <input id="title" v-model="form.title" :maxlength="MAX_TITLE" required placeholder="Например: распаковка наушников" />
      </div>

      <div class="field">
        <label for="description" class="section-title">Что снять</label>
        <textarea
          id="description"
          v-model="form.description"
          rows="5"
          :maxlength="MAX_DESCRIPTION"
          required
          placeholder="Формат, длительность, что обязательно показать или сказать"
        />
      </div>

      <fieldset class="field">
        <legend class="section-title">Категория</legend>
        <div class="chips">
          <button
            v-for="c in ORDER_CATEGORIES"
            :key="c.code"
            type="button"
            :aria-pressed="form.category === c.code"
            @click="form.category = c.code"
          >
            {{ c.label }}
          </button>
        </div>
      </fieldset>

      <div class="group">
        <label class="row">
          Цена за видео, ₽
          <input
            v-model.number="form.price"
            type="number"
            inputmode="numeric"
            min="1"
            :max="MAX_PRICE"
            step="1"
            placeholder="договорная"
          />
        </label>
        <div class="row column">
          <span id="deadline-label">Срок сдачи</span>
          <div class="segmented" role="radiogroup" aria-labelledby="deadline-label">
            <button
              v-for="d in DEADLINES"
              :key="d.label"
              type="button"
              role="radio"
              :aria-checked="form.deadlineDays === d.days"
              @click="form.deadlineDays = d.days"
            >
              {{ d.label }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <div class="bottom-bar">
      <p class="note">Заказ увидят креаторы после проверки модератором</p>
      <button type="submit" form="order-form" class="main-button" :disabled="sending">
        {{ sending ? 'Отправляем…' : 'Отправить на модерацию' }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px calc(120px + var(--safe-bottom));
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
}
.label-row {
  display: flex;
  justify-content: space-between;
  padding-right: 16px;
}
.label-row .section-title {
  padding-left: 16px;
}
.counter {
  font-size: 13px;
  color: var(--hint);
}
input,
textarea {
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
input {
  min-height: 48px;
  padding: 0 14px;
}
textarea {
  padding: 12px 14px;
  line-height: 1.4;
  resize: none;
}
input:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent);
}
legend {
  margin-bottom: 8px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chips button {
  min-height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.chips button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.group {
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
}
.row input {
  min-height: 44px;
  width: 160px;
  padding: 0;
  border: none;
  background: none;
  text-align: right;
}
.row.column {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--separator);
}
.segmented {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
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
.segmented button[aria-checked='true'] {
  background: var(--surface);
  font-weight: 600;
}
.note {
  margin: 0 0 8px;
  font-size: 13px;
  text-align: center;
  color: var(--hint);
}
.error {
  margin: 0;
  padding: 0 16px;
  font-size: 14px;
  color: var(--danger);
}
</style>
