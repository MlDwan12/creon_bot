<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  fetchMyProfile,
  fetchOpenOrders,
  categoryLabel,
  ORDER_CATEGORIES,
  type OrderCategory,
  type OrderSummary,
  PLATFORM_NAMES,
  VIDEO_PLATFORMS,
  updateNotifications,
  type VideoPlatform,
} from '../api';
import { RouterLink } from 'vue-router';
import { i18next } from '../i18n';
import EmptyState from '../components/EmptyState.vue';
import OrderCard from '../components/OrderCard.vue';
import PlatformIcon from '../components/PlatformIcon.vue';
import SupportLink from '../components/SupportLink.vue';
import LoadState from '../components/LoadState.vue';

// ref() — реактивное значение: поменяли `.value` в коде, и шаблон ниже перерисовался сам.
const category = ref<OrderCategory>();
// Площадку запоминаем: креатор обычно снимает для одной-двух, не выбирать каждый раз.
const PLATFORM_KEY = 'catalog.platform';
const platform = ref<VideoPlatform | undefined>(readPlatform());
function readPlatform() {
  try {
    const saved = localStorage.getItem(PLATFORM_KEY);
    return VIDEO_PLATFORMS.find((p) => p === saved);
  } catch {
    return undefined;
  }
}
const orders = ref<OrderSummary[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const error = ref('');

let lastRequest = 0;

/** reset — новая категория (с первой страницы); иначе дозагрузка следующей страницы. */
async function load(reset: boolean) {
  // Быстро переключили категорию дважды — ответ на старый запрос может прийти позже
  // нового и затереть список. Применяем только ответ на последний запрос.
  const requestId = ++lastRequest;
  loading.value = true;
  error.value = '';
  try {
    // Следующая страница — заказы старше последнего показанного (курсор, а не номер страницы).
    const res = await fetchOpenOrders(reset ? undefined : orders.value.at(-1), category.value, platform.value);
    if (requestId !== lastRequest) return;
    orders.value = reset ? res.items : [...orders.value, ...res.items];
    total.value = res.total;
    hasMore.value = res.hasMore;
  } catch {
    if (requestId === lastRequest) error.value = i18next.t('catalog.loadError');
  } finally {
    if (requestId === lastRequest) loading.value = false;
  }
}

const filtered = computed(() => Boolean(category.value || platform.value));
const empty = computed(() => !loading.value && !error.value && orders.value.length === 0);

// Пустой каталог: предлагаем включить сообщения о новых заказах, если они выключены.
// undefined — ещё не знаем (не показываем ни кнопку, ни текст про бота).
const notifyOn = ref<boolean>();
watch(
  empty,
  (e) => {
    if (e && notifyOn.value === undefined)
      fetchMyProfile().then((p) => (notifyOn.value = p.notifyNewOrders ?? true), () => {});
  },
  { immediate: true },
);
async function notifyMe() {
  try {
    await updateNotifications(true);
    notifyOn.value = true;
  } catch {
    // не вышло — кнопка останется, можно нажать ещё раз
  }
}

function resetFilters() {
  category.value = undefined;
  platform.value = undefined;
}

// Сменилась категория или площадка — грузим заново; immediate — и сразу при открытии экрана.
watch([category, platform], () => load(true), { immediate: true });
watch(platform, (p) => {
  try {
    if (p) localStorage.setItem(PLATFORM_KEY, p);
    else localStorage.removeItem(PLATFORM_KEY);
  } catch {
    // без хранилища просто не запомним
  }
});
</script>

<template>
  <main class="catalog">
    <header class="head">
      <h1>{{ $t('catalog.title') }}</h1>
      <p>{{ $t('catalog.subtitle') }}</p>
    </header>

    <nav class="chips" :aria-label="$t('catalog.platformsAria')">
      <button type="button" :aria-pressed="!platform" @click="platform = undefined">{{ $t('catalog.allPlatforms') }}</button>
      <button
        v-for="p in VIDEO_PLATFORMS"
        :key="p"
        type="button"
        class="with-icon"
        :aria-pressed="platform === p"
        @click="platform = p"
      >
        <PlatformIcon :platform="p" :size="24" round :inverse="platform === p" />
        {{ PLATFORM_NAMES[p] }}
      </button>
    </nav>

    <nav class="chips soft" :aria-label="$t('catalog.categoriesAria')">
      <button type="button" :aria-pressed="!category" @click="category = undefined">{{ $t('catalog.allCategories') }}</button>
      <button
        v-for="c in ORDER_CATEGORIES"
        :key="c"
        type="button"
        :aria-pressed="category === c"
        @click="category = c"
      >
        {{ categoryLabel(c) }}
      </button>
    </nav>

    <LoadState v-if="error" :error="error" @retry="load(true)" />
    <EmptyState v-else-if="empty && filtered" :title="$t('catalog.filteredTitle')" :text="$t('catalog.filteredText')">
      <template #icon>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
      </template>
      <button type="button" class="main-button" @click="resetFilters">{{ $t('catalog.resetFilters') }}</button>
    </EmptyState>
    <EmptyState
      v-else-if="empty"
      :title="$t('catalog.emptyTitle')"
      :text="notifyOn === undefined ? undefined : notifyOn ? $t('catalog.emptyNotifyOn') : $t('catalog.emptyNotifyOff')"
    >
      <template #icon>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </template>
      <button v-if="notifyOn === false" type="button" class="main-button" @click="notifyMe">{{ $t('catalog.notifyMe') }}</button>
    </EmptyState>
    <h2 v-else-if="total > 0" class="section-title count">{{ $t('catalog.openCount', { count: total }) }}</h2>

    <!-- Первая загрузка — заготовки карточек вместо пустого экрана. -->
    <LoadState v-if="loading && orders.length === 0" />
    <OrderCard v-for="o in orders" :key="o.id" :order="o" />

    <button
      v-if="hasMore"
      type="button"
      class="more"
      :disabled="loading"
      @click="load(false)"
    >
      {{ loading ? $t('catalog.loading') : $t('catalog.more') }}
    </button>

    <footer class="footer">
      <RouterLink to="/learn" class="quiet-link">{{ $t('catalog.howItWorks') }}</RouterLink>
      <SupportLink />
      <RouterLink to="/privacy" class="quiet-link">{{ $t('catalog.privacy') }}</RouterLink>
    </footer>
  </main>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Снизу место под плавающие вкладки. */
  padding: 20px 16px calc(96px + var(--safe-bottom));
}
.head h1 {
  margin: 0 0 4px;
  font-size: 26px;
  font-weight: 700;
}
.head p {
  margin: 0;
  font-size: 15px;
  color: var(--hint);
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -16px;
  padding: 0 16px;
  scrollbar-width: none;
  /* затухание у правого края: видно, что ряд прокручивается */
  mask-image: linear-gradient(to right, #000 85%, transparent);
}
.chips button {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
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
  padding-left: 6px;
}
.chips button[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 800;
}
/* Категории — второй уровень фильтра: тише площадок. */
.chips.soft {
  gap: 6px;
}
.chips.soft button {
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--hint);
  font-size: 13px;
}
.chips.soft button[aria-pressed='true'] {
  background: var(--accent-soft);
  color: var(--link);
}
.count {
  padding: 0;
  font-size: 15px;
  font-weight: 800;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text);
}
.hint {
  margin: 0;
  color: var(--hint);
}
.more {
  min-height: 48px;
  border: none;
  border-radius: 14px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 16px;
  font-weight: 700;
}
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}
</style>
