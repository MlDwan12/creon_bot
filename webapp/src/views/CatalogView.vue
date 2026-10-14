<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  fetchOpenOrders,
  ORDER_CATEGORIES,
  type OrderCategory,
  type OrderSummary,
  PLATFORM_NAMES,
  VIDEO_PLATFORMS,
  type VideoPlatform,
} from '../api';
import { RouterLink } from 'vue-router';
import OrderCard from '../components/OrderCard.vue';
import PlatformIcon from '../components/PlatformIcon.vue';
import SupportLink from '../components/SupportLink.vue';
import { onboardingOpen } from '../onboarding';

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
    if (requestId === lastRequest) error.value = 'Не удалось загрузить заказы';
  } finally {
    if (requestId === lastRequest) loading.value = false;
  }
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
      <h1>Заказы</h1>
      <p>Выберите задание, снимите видео и получите оплату</p>
    </header>

    <nav class="chips" aria-label="Площадки">
      <button type="button" :aria-pressed="!platform" @click="platform = undefined">Все площадки</button>
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

    <nav class="chips soft" aria-label="Категории">
      <button type="button" :aria-pressed="!category" @click="category = undefined">Все</button>
      <button
        v-for="c in ORDER_CATEGORIES"
        :key="c.code"
        type="button"
        :aria-pressed="category === c.code"
        @click="category = c.code"
      >
        {{ c.label }}
      </button>
    </nav>

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!loading && orders.length === 0" class="hint">
      Здесь пока нет заказов — попробуйте другую категорию или площадку.
    </p>
    <h2 v-else-if="total > 0" class="section-title count">{{ total }} открытых заказов</h2>

    <!-- Первая загрузка — заготовки карточек вместо пустого экрана. -->
    <template v-if="loading && orders.length === 0">
      <div v-for="i in 3" :key="i" class="skeleton" aria-hidden="true">
        <span class="bone short"></span>
        <span class="bone"></span>
        <span class="bone mid"></span>
      </div>
    </template>
    <OrderCard v-for="o in orders" :key="o.id" :order="o" />

    <button
      v-if="hasMore"
      type="button"
      class="more"
      :disabled="loading"
      @click="load(false)"
    >
      {{ loading ? 'Загрузка…' : 'Показать ещё' }}
    </button>

    <footer class="footer">
      <button type="button" class="quiet-link" @click="onboardingOpen = true">Как это работает</button>
      <SupportLink />
      <RouterLink to="/privacy" class="quiet-link">Политика конфиденциальности</RouterLink>
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
}
.chips button {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
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
  padding-left: 6px;
}
.chips button[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--ink-text);
  font-weight: 800;
}
/* Категории — второй уровень фильтра: тише площадок. */
.chips.soft {
  gap: 6px;
}
.chips.soft button {
  min-height: 34px;
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
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
  animation: pulse 1.4s ease-in-out infinite;
}
.bone {
  height: 16px;
  border-radius: 8px;
  background: var(--fill);
}
.bone.short {
  width: 40%;
}
.bone.mid {
  width: 65%;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
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
