<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  ApiError,
  type Feedback,
  fetchOrderReport,
  type OrderReport,
  PLATFORM_NAMES,
  rateVideo,
  sendReportCsv,
} from '../api';
import SupportLink from '../components/SupportLink.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { formatDate, formatMoney, formatViews } from '../format';
import { safeUrl } from '../telegram';

// `id` заказа из адреса /my-orders/:id/review.
const props = defineProps<{ id: string }>();

const data = ref<OrderReport>();
/** Порядок роликов: по просмотрам (как отдаёт сервер) или новые первыми. */
const sort = ref<'views' | 'date'>('views');
const items = computed(() => {
  const list = data.value?.items ?? [];
  return sort.value === 'views'
    ? list
    : [...list].sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''));
});
const csvState = ref<'idle' | 'sending' | 'sent'>('idle');
const csvError = ref('');

async function sendCsv() {
  csvState.value = 'sending';
  csvError.value = '';
  try {
    await sendReportCsv(Number(props.id));
    csvState.value = 'sent';
  } catch (err) {
    csvState.value = 'idle';
    csvError.value = err instanceof ApiError ? err.userMessage : 'Не удалось отправить файл';
  }
}
const loadError = ref('');
/** Какой ролик сейчас оценивают — форма открыта только у него. */
const rating = ref<number>();
const feedback = reactive<Feedback>({ rating: 0, review: '', portfolioAllowed: false });
const busy = ref(false);
const error = ref('');

async function load() {
  try {
    data.value = await fetchOrderReport(Number(props.id));
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить ролики';
  }
}

function startRating(id: number) {
  rating.value = id;
  error.value = '';
  Object.assign(feedback, { rating: 0, review: '', portfolioAllowed: false });
}

async function rate() {
  busy.value = true;
  error.value = '';
  try {
    await rateVideo(rating.value!, { ...feedback });
    const item = data.value!.items.find((i) => i.id === rating.value);
    if (item) item.rating = feedback.rating;
    rating.value = undefined;
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
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!data" class="hint">Загрузка…</p>

    <template v-else>
      <header class="head">
        <span class="hint">{{ data.order.title }}</span>
        <h1>Отчёт по заказу</h1>
      </header>

      <section class="tiles">
        <div class="tile">
          <strong>{{ formatViews(data.summary.views) }}</strong><span>просмотров · лайков {{ formatViews(data.summary.likes) }}</span>
        </div>
        <div class="tile"><strong>{{ data.summary.videos }}</strong><span>роликов · креаторов {{ data.summary.creators }}</span></div>
        <div class="tile">
          <strong>{{ formatMoney(data.summary.spent) }}</strong><span>потрачено из {{ formatMoney(data.summary.budget) }}</span>
        </div>
        <div class="tile">
          <strong>{{ data.summary.cpm === null ? '—' : formatMoney(data.summary.cpm) }}</strong><span>за 1000 просмотров</span>
        </div>
      </section>
      <p class="hint">
        Осталось {{ formatMoney(data.summary.left) }}<template v-if="data.summary.reserved">
          · ещё {{ formatMoney(data.summary.reserved) }} зарезервировано под ролики на проверке</template
        >. Суммы — вместе с комиссией площадки.
      </p>

      <section v-if="data.platforms.length" class="rows">
        <div v-for="p in data.platforms" :key="p.platform" class="row">
          <span>{{ PLATFORM_NAMES[p.platform] }}</span>
          <span>{{ p.videos }} · {{ formatViews(p.views) }} просмотров</span>
        </div>
      </section>

      <button type="button" class="secondary" :disabled="csvState !== 'idle'" @click="sendCsv">
        {{ csvState === 'sent' ? 'Файл отправлен в чат с ботом' : csvState === 'sending' ? 'Отправляем…' : 'Отчёт CSV — в чат с ботом' }}
      </button>
      <p v-if="csvError" class="error" role="alert">{{ csvError }}</p>

      <div class="title-row">
        <h2 class="section-title flush">Ролики</h2>
        <div class="segmented" role="radiogroup" aria-label="Порядок">
          <button type="button" role="radio" :aria-checked="sort === 'views'" @click="sort = 'views'">По просмотрам</button>
          <button type="button" role="radio" :aria-checked="sort === 'date'" @click="sort = 'date'">Новые</button>
        </div>
      </div>
      <p class="hint">
        Модератор проверил каждый ролик на соответствие заданию и зафиксировал просмотры. Оценка — по желанию: она попадёт
        в рейтинг креатора.
      </p>

      <p v-if="data.items.length === 0" class="hint">Одобренных роликов пока нет. Бот сообщит, когда появятся.</p>

      <article v-for="item in items" :key="item.id" class="item">
        <RouterLink :to="`/creators/${item.creatorId}`" class="creator">
          <UserAvatar :user-id="item.creatorId" :name="item.creator" />
          <div class="who">
            <div class="name">{{ item.creator }}</div>
            <div class="hint">
              {{ PLATFORM_NAMES[item.platform] }} · {{ formatViews(item.views) }} просмотров<template v-if="item.likes !== null">
                · {{ formatViews(item.likes) }} лайков</template
              ><template v-if="item.approvedAt">
                · {{ formatDate(item.approvedAt) }}</template
              >
            </div>
          </div>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>

        <a v-if="safeUrl(item.videoUrl)" :href="safeUrl(item.videoUrl)" target="_blank" rel="noopener noreferrer" class="video">
          <span class="play" aria-hidden="true">▶</span>
          <span class="link">
            <span class="url">{{ item.videoUrl }}</span>
            <strong>Открыть ролик</strong>
          </span>
        </a>
        <p v-else class="hint">Ссылка на ролик некорректна: {{ item.videoUrl }}</p>

        <p v-if="item.rating" class="rated" :aria-label="`Ваша оценка: ${item.rating} из 5`">
          {{ '★'.repeat(item.rating) }}{{ '☆'.repeat(5 - item.rating) }}
        </p>
        <fieldset v-else-if="rating === item.id" class="feedback">
          <legend class="section-title">Оцените работу креатора</legend>
          <div class="stars" role="radiogroup" aria-label="Оценка">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              role="radio"
              :aria-checked="feedback.rating === n"
              :aria-label="`${n} из 5`"
              :class="{ on: n <= feedback.rating }"
              @click="feedback.rating = n"
            >
              ★
            </button>
          </div>
          <textarea
            v-model="feedback.review"
            rows="3"
            maxlength="500"
            placeholder="Отзыв — по желанию. Его увидят в профиле креатора"
          />
          <label class="check">
            <input v-model="feedback.portfolioAllowed" type="checkbox" />
            Разрешить показать ролик в портфолио креатора
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="two">
            <button type="button" class="secondary" :disabled="busy" @click="rating = undefined">Отмена</button>
            <button type="button" class="main-button" :disabled="busy || !feedback.rating" @click="rate">
              Оценить
            </button>
          </div>
        </fieldset>
        <button v-else type="button" class="secondary" @click="startRating(item.id)">Оценить</button>

        <RouterLink
          :to="{ path: '/report', query: { target: 'VIDEO', id: item.id, title: `Видео от ${item.creator}` } }"
          class="quiet-link"
        >
          Пожаловаться на ролик
        </RouterLink>
      </article>

      <SupportLink
        :label="`Вопрос по заказу #${data.order.id} — написать менеджеру`"
        :about="`Вопрос по заказу #${data.order.id} «${data.order.title}»`"
      />
    </template>
  </main>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.tile strong {
  font-size: 22px;
}
.tile span {
  font-size: 13px;
  color: var(--hint);
}
.rows {
  border-radius: 14px;
  background: var(--surface);
}
.rows .row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 15px;
}
.rows .row + .row {
  border-top: 1px solid var(--separator);
}
.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.flush {
  padding: 0;
}
.segmented {
  display: flex;
  padding: 2px;
  border-radius: 9px;
  background: var(--fill);
}
.segmented button {
  min-height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font-size: 13px;
}
.segmented button[aria-checked='true'] {
  background: var(--surface);
  font-weight: 600;
}
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--separator);
}
.creator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.who {
  flex: 1;
  min-width: 0;
}
.chevron {
  color: var(--hint);
  font-size: 22px;
}
.name {
  font-size: 16px;
  font-weight: 600;
}
.video {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.play {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: #1c1c22;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.url {
  font-size: 14px;
  color: var(--hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link strong {
  color: var(--link);
}
.rated {
  margin: 0;
  color: #d99a00;
  font-size: 22px;
}
.feedback {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: var(--surface);
}
.feedback legend {
  float: left;
  padding: 0;
}
.stars {
  display: flex;
  gap: 4px;
}
.stars button {
  width: 44px;
  height: 44px;
  border: none;
  background: none;
  color: var(--separator);
  font-size: 32px;
  line-height: 1;
}
.stars button.on {
  color: #d99a00;
}
.feedback textarea {
  padding: 10px 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}
.check input {
  width: 20px;
  height: 20px;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.secondary {
  height: 50px;
  border: none;
  border-radius: 12px;
  background: var(--fill);
  color: var(--text);
  font-size: 17px;
  font-weight: 600;
}
</style>
