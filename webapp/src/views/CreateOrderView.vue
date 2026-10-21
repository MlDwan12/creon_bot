<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ApiError,
  createOrder,
  fetchMe,
  fetchMyOrders,
  fetchRate,
  type MyOrder,
  categoryLabel,
  ORDER_CATEGORIES,
  type NewOrderInput,
  type OrderSummary,
  PLATFORM_NAMES,
  updateOrder,
  VIDEO_PLATFORMS,
  type VideoPlatform,
} from '../api';
import OrderCard from '../components/OrderCard.vue';
import PlatformIcon from '../components/PlatformIcon.vue';
import { i18next, locale } from '../i18n';
import { approxRub, formatMoney } from '../format';

// Лимиты — те же, что проверяет бэкенд (src/common/validation.ts); здесь только подсказка браузеру.
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MIN_BUDGET = 10;
const MAX_BUDGET = 100_000;
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

/** Что стоит в форме нового заказа, пока рекламодатель не поменял: любое видео 15–60 сек, порог 250, без срока. */
const DEFAULTS = {
  minViews: 250,
  minDurationSec: 15,
  maxDurationSec: 60,
  orientation: null,
  deadlineDays: null,
} as const;

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
// Обязательно всё, кроме ссылки на товар. Требования к ролику и срок заполнены по умолчанию
// (DEFAULTS) — не трогал, они и уйдут; тексты, категорию и бюджет рекламодатель задаёт сам.
// v-model.number отдаёт '' для пустого ввода. «Любое» — null, «Любая площадка» — [], категория
// undefined — ещё не выбрали. У срока при правке undefined — «как было».
const form = reactive<
  Omit<
    NewOrderInput,
    | 'referenceUrl'
    | 'targetUrl'
    | 'budget'
    | 'minViews'
    | 'minDurationSec'
    | 'maxDurationSec'
    | 'orientation'
    | 'platforms'
    | 'category'
    | 'deadlineDays'
  > & {
    referenceUrl: string;
    targetUrl: string;
    budget: number | '';
    minViews: number | '';
    minDurationSec: number | '';
    maxDurationSec: number | '';
    orientation: NewOrderInput['orientation'];
    platforms: VideoPlatform[];
    category: NewOrderInput['category'] | undefined;
    deadlineDays: number | null | undefined;
  }
>({
  title: '',
  description: '',
  referenceUrl: '',
  targetUrl: '',
  budget: '',
  ...DEFAULTS,
  // при правке срок по умолчанию — «как было», а не «без срока»
  deadlineDays: props.id === undefined ? DEFAULTS.deadlineDays : undefined,
  platforms: [],
  category: undefined,
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

/** Отметить площадку или снять отметку; «Любая» — пустой список. */
function togglePlatform(p: VideoPlatform) {
  const list = form.platforms;
  form.platforms = list.includes(p) ? list.filter((x) => x !== p) : [...list, p];
}

/** Требования не трогали — подпись «по умолчанию» у поля (и список в проверке перед отправкой). */
const isDefault = computed(() => ({
  orientation: form.orientation === DEFAULTS.orientation,
  duration: form.minDurationSec === DEFAULTS.minDurationSec && form.maxDurationSec === DEFAULTS.maxDurationSec,
  platforms: form.platforms.length === 0,
  minViews: form.minViews === DEFAULTS.minViews,
  deadline: !props.id && form.deadlineDays === DEFAULTS.deadlineDays,
}));

// Ошибки — под полем, а не всплывающей подсказкой браузера: novalidate у формы, правила те же
// (required, min, max, type="url"), текст — validationMessage браузера на языке телефона.
const formEl = ref<HTMLFormElement>();
const fieldErrors = reactive<Record<string, string>>({});
const categoryError = ref('');
function validate(): boolean {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  categoryError.value = '';
  const invalid = [...formEl.value!.elements].filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement,
  ).filter((el) => !el.checkValidity());
  for (const el of invalid) fieldErrors[el.id] = el.validationMessage;
  if (form.category === undefined) categoryError.value = i18next.t('errors.chooseCategory');
  const first = invalid[0] ?? (categoryError.value ? document.getElementById('category') : null);
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (invalid[0]) invalid[0].focus({ preventScroll: true });
  return !invalid.length && !categoryError.value;
}

// Проверка перед отправкой нового заказа: карточка, как её увидят креаторы, и деньги с комиссией.
const previewing = ref(false);
const feePercent = ref<number>();
void fetchMe().then((me) => (feePercent.value = me.feePercent), () => {});
const previewOrder = computed<OrderSummary>(() => ({
  id: 0,
  title: form.title,
  description: form.description,
  referenceUrl: form.referenceUrl || null,
  cpm: null,
  minViews: Number(form.minViews),
  free: pool.value ?? Number(form.budget),
  budgetLow: false,
  category: form.category!,
  deadline: null,
  createdAt: new Date().toISOString(),
  minDurationSec: Number(form.minDurationSec) || null,
  maxDurationSec: Number(form.maxDurationSec) || null,
  orientation: form.orientation,
  platforms: form.platforms,
}));
/** Креаторам — бюджет без комиссии, как payoutPool на бэкенде (вниз до центов). */
const pool = computed(() =>
  feePercent.value === undefined
    ? undefined
    : Math.floor(Number(form.budget) * (100 - feePercent.value)) / 100,
);
const defaultsLabels = computed(() =>
  [
    isDefault.value.orientation && i18next.t('createOrder.preview.anyOrientation'),
    isDefault.value.duration &&
      i18next.t('format.secRange', { min: DEFAULTS.minDurationSec, max: DEFAULTS.maxDurationSec }),
    isDefault.value.platforms && i18next.t('orderCard.anyPlatform'),
    isDefault.value.minViews && i18next.t('orderCard.minViews', { views: DEFAULTS.minViews }),
    isDefault.value.deadline && i18next.t('createOrder.preview.noDeadline'),
  ].filter((l): l is string => Boolean(l)),
);

async function submit() {
  error.value = '';
  if (!validate()) return;
  const category = form.category!;
  // новый заказ — сначала проверка; правку отправляем сразу
  if (!props.id && !previewing.value) {
    previewing.value = true;
    window.scrollTo({ top: 0 });
    return;
  }
  sending.value = true;
  try {
    const input = {
      ...form,
      category,
      referenceUrl: form.referenceUrl.trim() || null,
      targetUrl: form.targetUrl.trim() || null,
      budget: Number(form.budget),
      minViews: Number(form.minViews),
      minDurationSec: Number(form.minDurationSec),
      maxDurationSec: Number(form.maxDurationSec),
    };
    if (props.id) await updateOrder(Number(props.id), input);
    // при создании «как было» не бывает — срок по умолчанию null
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
    <h1 v-show="!previewing">{{ props.id ? $t('createOrder.titleEdit') : $t('createOrder.titleNew') }}</h1>
    <p v-show="!previewing && !props.id" class="lead">{{ $t('createOrder.defaultsNote') }}</p>

    <!-- v-show, а не v-if: в проверке перед отправкой форма скрыта, но её поля и правила на месте -->
    <form v-show="!previewing" id="order-form" ref="formEl" class="form" novalidate @submit.prevent="submit">
      <h2 class="block-title">{{ $t('createOrder.blockTask') }}</h2>
      <div class="field">
        <div class="label-row">
          <label for="title" class="section-title">{{ $t('createOrder.name') }}</label>
          <span class="counter">{{ form.title.length }} / {{ MAX_TITLE }}</span>
        </div>
        <!-- v-model — двусторонняя связь: ввод в поле сразу попадает в form.title и обратно. -->
        <input id="title" v-model="form.title" :maxlength="MAX_TITLE" required :placeholder="$t('createOrder.namePlaceholder')" />
        <p v-if="fieldErrors.title" class="field-error" role="alert">{{ fieldErrors.title }}</p>
      </div>

      <div class="field">
        <label for="description" class="section-title">{{ $t('createOrder.task') }}</label>
        <textarea
          id="description"
          v-model="form.description"
          rows="5"
          :maxlength="MAX_DESCRIPTION"
          required
          :placeholder="$t('createOrder.briefPlaceholder')"
        />
        <p v-if="fieldErrors.description" class="field-error" role="alert">{{ fieldErrors.description }}</p>
      </div>

      <div class="field">
        <label for="reference" class="section-title">{{ $t('createOrder.reference') }}</label>
        <input
          id="reference"
          v-model="form.referenceUrl"
          type="url"
          inputmode="url"
          maxlength="500"
          required
          :placeholder="$t('createOrder.referencePlaceholder')"
        />
        <p v-if="fieldErrors.reference" class="field-error" role="alert">{{ fieldErrors.reference }}</p>
      </div>

      <div class="field">
        <label for="target" class="section-title">
          {{ $t('createOrder.target') }} <small class="optional">{{ $t('createOrder.optional') }}</small>
        </label>
        <input
          id="target"
          v-model="form.targetUrl"
          type="url"
          inputmode="url"
          maxlength="500"
          :placeholder="$t('createOrder.targetPlaceholder')"
        />
        <p v-if="fieldErrors.target" class="field-error" role="alert">{{ fieldErrors.target }}</p>
        <span class="hint">{{ $t('createOrder.targetHint') }}</span>
      </div>

      <h2 class="block-title">{{ $t('createOrder.requirements') }}</h2>
      <div class="field">
        <div class="group">
          <div class="row column">
            <span id="orientation-label">
              {{ $t('createOrder.orientation') }}
              <small v-if="isDefault.orientation" class="default">{{ $t('createOrder.byDefault') }}</small>
            </span>
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
            <span>
              {{ $t('createOrder.durationFrom') }}
              <small v-if="isDefault.duration" class="default">{{ $t('createOrder.byDefault') }}</small>
            </span>
            <input
              id="minDuration"
              v-model.number="form.minDurationSec"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_DURATION"
              step="1"
              required
              placeholder="15"
            />
          </label>
          <label class="row bordered">
            {{ $t('createOrder.durationTo') }}
            <input
              id="maxDuration"
              v-model.number="form.maxDurationSec"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_DURATION"
              step="1"
              required
              placeholder="60"
            />
          </label>
        </div>
        <p v-if="fieldErrors.minDuration || fieldErrors.maxDuration" class="field-error" role="alert">
          {{ fieldErrors.minDuration || fieldErrors.maxDuration }}
        </p>
      </div>

      <fieldset class="field">
        <legend class="section-title">
          {{ $t('createOrder.platforms') }}
          <small v-if="isDefault.platforms" class="default">{{ $t('createOrder.byDefault') }}</small>
        </legend>
        <div class="chips">
          <button type="button" :aria-pressed="form.platforms.length === 0" @click="form.platforms = []">
            {{ $t('createOrder.anyPlatform') }}
          </button>
          <button
            v-for="p in VIDEO_PLATFORMS"
            :key="p"
            type="button"
            class="with-icon"
            :aria-pressed="!!form.platforms.includes(p)"
            @click="togglePlatform(p)"
          >
            <PlatformIcon :platform="p" :size="26" round :inverse="!!form.platforms.includes(p)" />
            {{ PLATFORM_NAMES[p] }}
          </button>
        </div>
        <span class="hint">{{ $t('createOrder.platformsHint') }}</span>
      </fieldset>

      <fieldset id="category" class="field" :aria-describedby="categoryError ? 'category-error' : undefined">
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
        <p v-if="categoryError" id="category-error" class="field-error" role="alert">{{ categoryError }}</p>
      </fieldset>

      <h2 class="block-title">{{ $t('createOrder.blockBudget') }}</h2>

      <div class="group">
        <label class="row">
          {{ $t('createOrder.budget') }}
          <input
            id="budget"
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
          <span>
            {{ $t('createOrder.minViews') }}
            <small v-if="isDefault.minViews" class="default">{{ $t('createOrder.byDefault') }}</small>
          </span>
          <input
            id="minViews"
            v-model.number="form.minViews"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            required
            placeholder="250"
          />
        </label>
        <div class="row column">
          <span id="deadline-label">
            {{ $t('createOrder.deadline') }}
            <small v-if="isDefault.deadline" class="default">{{ $t('createOrder.byDefault') }}</small>
          </span>
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
      <p v-if="fieldErrors.budget || fieldErrors.minViews" class="field-error" role="alert">
        {{ fieldErrors.budget || fieldErrors.minViews }}
      </p>

      <p v-if="rubPerUsdt && form.budget" class="hint">
        {{ $t('createOrder.rate', { rub: approxRub(form.budget, rubPerUsdt), rate: rubPerUsdt.toLocaleString(locale()) }) }}
      </p>
      <p class="hint">
        {{ $t('createOrder.howPay') }}
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <template v-if="previewing">
      <header class="preview-head">
        <h1>{{ $t('createOrder.preview.title') }}</h1>
        <p class="lead">{{ $t('createOrder.preview.subtitle') }}</p>
      </header>
      <h2 class="block-title">{{ $t('createOrder.preview.card') }}</h2>
      <OrderCard :order="previewOrder" preview />

      <h2 class="block-title">{{ $t('createOrder.preview.money') }}</h2>
      <div class="group">
        <div class="row">
          <span>{{ $t('createOrder.preview.budget') }}</span>
          <strong>{{ formatMoney(Number(form.budget)) }}</strong>
        </div>
        <template v-if="pool !== undefined && feePercent !== undefined">
          <div class="row bordered">
            <span>{{ $t('createOrder.preview.pool') }}</span>
            <strong>{{ formatMoney(pool) }}</strong>
          </div>
          <div class="row bordered">
            <span>{{ $t('createOrder.preview.fee') }}</span>
            <strong>
              {{ $t('createOrder.preview.feeValue', { percent: feePercent, amount: formatMoney(Number(form.budget) - pool) }) }}
            </strong>
          </div>
        </template>
      </div>
      <p class="lead">{{ $t('createOrder.preview.moneyNote') }}</p>

      <template v-if="defaultsLabels.length">
        <h2 class="block-title">{{ $t('createOrder.preview.defaults') }}</h2>
        <ul class="defaults">
          <li v-for="l in defaultsLabels" :key="l">{{ l }}</li>
        </ul>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>

    <div class="bottom-bar">
      <p v-if="editing?.status === 'OPEN'" class="note">
        {{ $t('createOrder.editNote') }}
      </p>
      <p v-else class="note">{{ $t('createOrder.newNote') }}</p>
      <div :class="{ two: previewing }">
        <button v-if="previewing" type="button" class="secondary-button" @click="previewing = false">
          {{ $t('createOrder.preview.edit') }}
        </button>
        <button type="submit" form="order-form" class="main-button" :disabled="sending">
          {{
            sending
              ? $t('common.sending')
              : props.id
                ? $t('createOrder.saveAndSend')
                : previewing
                  ? $t('createOrder.send')
                  : $t('createOrder.check')
          }}
        </button>
      </div>
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
  min-height: 44px;
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
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
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
  min-height: 44px;
  padding: 0 4px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
}
.segmented button[aria-checked='true'] {
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--accent);
  font-weight: 800;
}
/* Блоки формы: «Что снять», «Требования», «Бюджет» — заголовком, как в проверке перед отправкой. */
.block-title {
  margin: 8px 0 -4px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
}
/* Подписи полей — обычным текстом, а не мелким капсом: так их легче читать. */
.form .section-title {
  padding: 0;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
}
.label-row .section-title {
  padding-left: 0;
}
.label-row {
  padding-right: 0;
}
.optional,
.default {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 600;
}
.optional {
  color: var(--hint);
}
.default {
  color: var(--link);
}
/* в строках с полем справа метка — отдельной строкой под подписью, без переноса посреди слов */
.row > span .default {
  display: block;
  margin-left: 0;
}
.field-error {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--danger);
}
.lead {
  margin: -8px 0 0;
  font-size: 14px;
  color: var(--hint);
}
.preview-head h1 {
  margin: 0 0 4px;
}
.preview-head .lead {
  margin: 0;
}
.defaults {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.defaults li {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: var(--accent-soft);
  font-size: 14px;
  font-weight: 700;
}
.two {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
}
.two .secondary-button {
  padding: 0 18px;
}
.secondary-button {
  height: 54px;
  border: none;
  border-radius: var(--radius-button);
  background: var(--fill);
  color: var(--text);
  font-size: 16px;
  font-weight: 800;
}
.note {
  margin: 0 0 8px;
  font-size: 13px;
  text-align: center;
  color: var(--hint);
}
.hint {
  margin: -2px 0 0;
  padding: 0;
  font-size: 13px;
  color: var(--hint);
}
.error {
  margin: 0;
  padding: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
