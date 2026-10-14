<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ApiError,
  createOrder,
  fetchMyOrders,
  fetchRate,
  type MyOrder,
  categoryLabel,
  ORDER_CATEGORIES,
  type NewOrderInput,
  PLATFORM_NAMES,
  updateOrder,
  VIDEO_PLATFORMS,
  type VideoPlatform,
} from '../api';
import PlatformIcon from '../components/PlatformIcon.vue';
import { i18next, locale } from '../i18n';
import { approxRub } from '../format';

// Лимиты — те же, что проверяет бэкенд (src/common/validation.ts); здесь только подсказка браузеру.
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MIN_BUDGET = 10;
const MAX_BUDGET = 100_000;
const DEFAULT_MIN_VIEWS = 250;
const MAX_DURATION = 600;
const ORIENTATIONS: { value: NewOrderInput['orientation']; label: string }[] = [
  { value: 'VERTICAL', label: 'createOrder.vertical' },
  { value: 'HORIZONTAL', label: 'createOrder.horizontal' },
  { value: null, label: 'createOrder.anyOrientation' },
];
// С `id` (/my-orders/:id/edit) — правка своего заказа, без — новый.
const props = defineProps<{ id?: string }>();
// курс — только подсказка «≈ … ₽», не загрузился — не показываем
const rubPerUsdt = ref<number | null>(null);
void fetchRate().then((r) => (rubPerUsdt.value = r));

/** undefined — «не менять» (только при правке), null — без срока. */
const DEADLINES: (number | null | undefined)[] = [3, 7, 14, 30, null];
/** Подпись варианта срока: «7 дн», «нет», при правке — «как было». */
function deadlineLabel(days: number | null | undefined): string {
  if (days === undefined) return i18next.t('createOrder.keepDeadline');
  if (days === null) return i18next.t('createOrder.noDeadline');
  return i18next.t('createOrder.days', { count: days });
}

const route = useRoute();
const router = useRouter();

// reactive() — как ref(), но для объекта целиком: form.title и т.д. без `.value`.
// v-model.number отдаёт '' для пустого ввода: budget '' — ещё не введён, minViews '' — порог по умолчанию.
const form = reactive<
  Omit<
    NewOrderInput,
    'referenceUrl' | 'targetUrl' | 'budget' | 'minViews' | 'minDurationSec' | 'maxDurationSec' | 'deadlineDays'
  > & {
    referenceUrl: string;
    targetUrl: string;
    budget: number | '';
    minViews: number | '';
    minDurationSec: number | '';
    maxDurationSec: number | '';
    deadlineDays: number | null | undefined;
  }
>({
  title: '',
  description: '',
  referenceUrl: '',
  targetUrl: '',
  budget: '',
  minViews: DEFAULT_MIN_VIEWS,
  // Короткие вертикальные ролики — самый частый заказ; рекламодатель может поменять.
  minDurationSec: 15,
  maxDurationSec: 60,
  orientation: 'VERTICAL',
  platforms: [],
  category: 'OTHER',
  deadlineDays: props.id ? undefined : 7,
});
/** Редактируемый заказ — для подсказки, что открытый уйдёт на повторную проверку. */
const editing = ref<MyOrder>();
const deadlines = computed(() => (props.id ? [undefined, ...DEADLINES] : DEADLINES));
const sending = ref(false);
const error = ref('');

/**
 * Правка (/my-orders/:id/edit) или «Исправить и отправить снова» (/my-orders/new?from=<id>) —
 * подставляем данные заказа в форму.
 */
async function prefill() {
  const fromId = Number(props.id ?? route.query.from);
  if (!fromId) return;
  const source = (await fetchMyOrders().catch(() => [])).find((o) => o.id === fromId);
  if (!source) return;
  if (props.id) editing.value = source;
  form.title = source.title;
  form.description = source.description;
  form.referenceUrl = source.referenceUrl ?? '';
  form.targetUrl = source.targetUrl ?? '';
  form.budget = source.budget;
  form.minViews = source.minViews;
  form.minDurationSec = source.minDurationSec ?? '';
  form.maxDurationSec = source.maxDurationSec ?? '';
  form.orientation = source.orientation;
  form.platforms = [...source.platforms];
  form.category = source.category;
}

/** Отметить площадку или снять отметку. */
function togglePlatform(p: VideoPlatform) {
  form.platforms = form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p];
}

async function submit() {
  sending.value = true;
  error.value = '';
  try {
    const budget = Number(form.budget);
    const minViews = form.minViews === '' ? null : form.minViews;
    const referenceUrl = form.referenceUrl.trim() || null;
    const targetUrl = form.targetUrl.trim() || null;
    const minDurationSec = form.minDurationSec === '' ? null : form.minDurationSec;
    const maxDurationSec = form.maxDurationSec === '' ? null : form.maxDurationSec;
    const input = { ...form, referenceUrl, targetUrl, budget, minViews, minDurationSec, maxDurationSec };
    if (props.id) await updateOrder(Number(props.id), input);
    // при создании «как было» не бывает — срок всегда выбран
    else await createOrder({ ...input, deadlineDays: form.deadlineDays ?? null });
    await router.replace('/my-orders');
  } catch (err) {
    // Тексты ошибок проверки пишет бэкенд.
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('createOrder.sendError');
  } finally {
    sending.value = false;
  }
}

void prefill();
</script>

<template>
  <main class="page">
    <h1>{{ props.id ? $t('createOrder.titleEdit') : $t('createOrder.titleNew') }}</h1>

    <form id="order-form" class="form" @submit.prevent="submit">
      <div class="field">
        <div class="label-row">
          <label for="title" class="section-title">{{ $t('createOrder.name') }}</label>
          <span class="counter">{{ form.title.length }} / {{ MAX_TITLE }}</span>
        </div>
        <!-- v-model — двусторонняя связь: ввод в поле сразу попадает в form.title и обратно. -->
        <input id="title" v-model="form.title" :maxlength="MAX_TITLE" required :placeholder="$t('createOrder.namePlaceholder')" />
      </div>

      <div class="field">
        <label for="description" class="section-title">{{ $t('createOrder.brief') }}</label>
        <textarea
          id="description"
          v-model="form.description"
          rows="5"
          :maxlength="MAX_DESCRIPTION"
          required
          :placeholder="$t('createOrder.briefPlaceholder')"
        />
      </div>

      <div class="field">
        <label for="reference" class="section-title">{{ $t('createOrder.reference') }}</label>
        <input
          id="reference"
          v-model="form.referenceUrl"
          type="url"
          inputmode="url"
          maxlength="500"
          :placeholder="$t('createOrder.referencePlaceholder')"
        />
      </div>

      <div class="field">
        <label for="target" class="section-title">{{ $t('createOrder.target') }}</label>
        <input
          id="target"
          v-model="form.targetUrl"
          type="url"
          inputmode="url"
          maxlength="500"
          :placeholder="$t('createOrder.targetPlaceholder')"
        />
        <span class="hint">{{ $t('createOrder.targetHint') }}</span>
      </div>

      <div class="field">
        <span class="section-title">{{ $t('createOrder.requirements') }}</span>
        <div class="group">
          <div class="row column">
            <span id="orientation-label">{{ $t('createOrder.orientation') }}</span>
            <div class="segmented" role="radiogroup" aria-labelledby="orientation-label">
              <button
                v-for="o in ORIENTATIONS"
                :key="o.label"
                type="button"
                role="radio"
                :aria-checked="form.orientation === o.value"
                @click="form.orientation = o.value"
              >
                {{ $t(o.label) }}
              </button>
            </div>
          </div>
          <label class="row bordered">
            {{ $t('createOrder.durationFrom') }}
            <input
              v-model.number="form.minDurationSec"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_DURATION"
              step="1"
              :placeholder="$t('createOrder.any')"
            />
          </label>
          <label class="row bordered">
            {{ $t('createOrder.durationTo') }}
            <input
              v-model.number="form.maxDurationSec"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_DURATION"
              step="1"
              :placeholder="$t('createOrder.any')"
            />
          </label>
        </div>
      </div>

      <fieldset class="field">
        <legend class="section-title">{{ $t('createOrder.platforms') }}</legend>
        <div class="chips">
          <button
            v-for="p in VIDEO_PLATFORMS"
            :key="p"
            type="button"
            class="with-icon"
            :aria-pressed="form.platforms.includes(p)"
            @click="togglePlatform(p)"
          >
            <PlatformIcon :platform="p" :size="26" round :inverse="form.platforms.includes(p)" />
            {{ PLATFORM_NAMES[p] }}
          </button>
        </div>
        <span class="hint">{{ $t('createOrder.platformsHint') }}</span>
      </fieldset>

      <fieldset class="field">
        <legend class="section-title">{{ $t('createOrder.category') }}</legend>
        <div class="chips">
          <button
            v-for="c in ORDER_CATEGORIES"
            :key="c"
            type="button"
            :aria-pressed="form.category === c"
            @click="form.category = c"
          >
            {{ categoryLabel(c) }}
          </button>
        </div>
      </fieldset>

      <div class="group">
        <label class="row">
          {{ $t('createOrder.budget') }}
          <input
            v-model.number="form.budget"
            type="number"
            inputmode="numeric"
            :min="MIN_BUDGET"
            :max="MAX_BUDGET"
            step="1"
            required
            :placeholder="$t('createOrder.budgetPlaceholder', { min: MIN_BUDGET.toLocaleString(locale()) })"
          />
        </label>
        <label class="row bordered">
          {{ $t('createOrder.minViews') }}
          <input
            v-model.number="form.minViews"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :placeholder="String(DEFAULT_MIN_VIEWS)"
          />
        </label>
        <div class="row column">
          <span id="deadline-label">{{ $t('createOrder.deadline') }}</span>
          <div class="segmented" role="radiogroup" aria-labelledby="deadline-label">
            <button
              v-for="d in deadlines"
              :key="String(d)"
              type="button"
              role="radio"
              :aria-checked="form.deadlineDays === d"
              @click="form.deadlineDays = d"
            >
              {{ deadlineLabel(d) }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="rubPerUsdt && form.budget" class="hint">
        {{ $t('createOrder.rate', { rub: approxRub(form.budget, rubPerUsdt), rate: rubPerUsdt.toLocaleString(locale()) }) }}
      </p>
      <p class="hint">
        {{ $t('createOrder.howPay') }}
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <div class="bottom-bar">
      <p v-if="editing?.status === 'OPEN'" class="note">
        {{ $t('createOrder.editNote') }}
      </p>
      <p v-else class="note">{{ $t('createOrder.newNote') }}</p>
      <button type="submit" form="order-form" class="main-button" :disabled="sending">
        {{ sending ? $t('common.sending') : props.id ? $t('createOrder.saveAndSend') : $t('createOrder.send') }}
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1.5px solid var(--separator);
  border-radius: 20px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.chips button.with-icon {
  min-height: 44px;
  padding-left: 8px;
}
.chips button[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--ink-text);
  font-weight: 800;
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
.row.bordered {
  border-top: 1px solid var(--separator);
}
.row.column {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--separator);
}
.row.column:first-child {
  border-top: none;
}
.segmented {
  display: grid;
  /* Сколько вариантов, столько колонок: 3 ориентации, 5–6 сроков. */
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
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
.hint {
  margin: -8px 0 0;
  padding: 0 16px;
  font-size: 13px;
  color: var(--hint);
}
.error {
  margin: 0;
  padding: 0 16px;
  font-size: 14px;
  color: var(--danger);
}
</style>
