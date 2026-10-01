<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  ApiError,
  fetchModQueue,
  fetchModVideo,
  finalizeVideo,
  type ModVideo,
  moderateVideo,
  PLATFORM_NAMES,
} from '../../api';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { formatCpm, formatDate, formatMoney, formatVideoFormat, formatViews, timeAgo } from '../../format';
import { safeUrl } from '../../telegram';

const props = defineProps<{ id: string }>();
const router = useRouter();

const PRESETS = [
  'Не соответствует заданию',
  'Не та длительность ролика',
  'Не та ориентация (вертикаль / горизонталь)',
  'Меньше порога просмотров',
  'Публикация закрыта или удалена',
  'Ссылка не открывается — проверьте доступ',
  'Низкое качество видео',
  'Водяной знак или чужой логотип',
  'Чужой или перезалитый ролик',
];

const video = ref<ModVideo>();
const loadError = ref('');
const comment = ref('');
const busy = ref(false);
const error = ref('');

async function load() {
  video.value = undefined;
  loadError.value = '';
  comment.value = '';
  try {
    video.value = await fetchModVideo(Number(props.id));
    // Просмотры из API площадки точнее заявленных — подставляем их.
    views.value = video.value.autoViews ?? video.value.views ?? '';
    likes.value = video.value.autoLikes ?? video.value.likes ?? '';
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить видео';
  }
}

/** После решения — следующее из той же очереди (проверка или итог добора); пуста — назад к ней. */
async function goNext(tab: 'videos' | 'topups') {
  const next = (await fetchModQueue().catch(() => undefined))?.[tab].find((v) => v.id !== Number(props.id));
  await router.replace(next ? `/mod/videos/${next.id}` : `/mod?tab=${tab}`);
}

async function run(action: () => Promise<unknown>, tab: 'videos' | 'topups') {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await goNext(tab);
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

const decide = (decision: 'approve' | 'reject') =>
  run(
    () =>
      moderateVideo(
        Number(props.id),
        decision,
        decision === 'reject' ? { comment: comment.value } : { views: Number(views.value), likes: likesOrNull() },
      ),
    'videos',
  );
const finalize = () => run(() => finalizeVideo(Number(props.id), Number(views.value), likesOrNull()), 'topups');

/** Просмотры, которые фиксирует модератор: на проверке — заявленные креатором, при итоге — текущие. */
const views = ref<number | ''>('');
/** Лайки — только для отчёта рекламодателю, по желанию; пусто — неизвестно. */
const likes = ref<number | ''>('');
const likesOrNull = () => (likes.value === '' ? null : likes.value);
/** Сколько начислится за введённые просмотры (без учёта остатка бюджета). */
const estimate = computed(() => {
  const cpm = video.value?.order.cpm;
  return cpm && views.value ? formatMoney(Math.floor((views.value * cpm) / 10) / 100) : '';
});
/** Когда можно зафиксировать итог после добора; null — не одобрен или уже зафиксирован. */
const topupAt = computed(() => {
  const v = video.value;
  if (!v || v.status !== 'MODERATOR_APPROVED' || v.finalizedAt || !v.decidedAt) return null;
  return new Date(new Date(v.decidedAt).getTime() + v.topupDays * 24 * 60 * 60 * 1000);
});

watch(() => props.id, load, { immediate: true });
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!video" class="hint">Загрузка…</p>

    <template v-else>
      <header class="head">
        <span class="hint">
          <RouterLink :to="`/mod/creators/${video.creatorId}`">{{ video.creator }}</RouterLink> · видео {{ video.attempt }}<template v-if="video.submittedAt"> · {{ timeAgo(video.submittedAt) }}</template>
        </span>
        <h1>{{ video.order.title }}</h1>
      </header>

      <a v-if="safeUrl(video.videoUrl)" :href="safeUrl(video.videoUrl)" target="_blank" rel="noopener noreferrer" class="video">
        <span class="play" aria-hidden="true">▶</span>
        <span class="link">
          <span class="url">{{ video.videoUrl }}</span>
          <strong>Открыть видео</strong>
        </span>
      </a>
      <p v-else class="hint">Ссылка на видео некорректна: {{ video.videoUrl }}</p>

      <section class="block">
        <h2 class="section-title">Сверьте с заданием</h2>
        <div class="text">{{ video.order.description }}</div>
        <p v-if="formatVideoFormat(video.order)" class="text">Ролик: {{ formatVideoFormat(video.order) }}</p>
      </section>

      <section class="rows">
        <div class="row"><span>Ставка</span><span>{{ formatCpm(video.order.cpm) }}</span></div>
        <div class="row"><span>Порог</span><span>от {{ formatViews(video.order.minViews) }} просмотров</span></div>
        <div class="row"><span>Свободно в бюджете</span><span>{{ formatMoney(video.order.free) }}</span></div>
        <div v-if="video.autoViews !== null" class="row">
          <span>Сейчас по данным {{ PLATFORM_NAMES[video.platform] }}</span>
          <span>{{ formatViews(video.autoViews) }} просмотров</span>
        </div>
        <div v-if="video.views !== null" class="row">
          <span>{{ video.status === 'SUBMITTED' ? 'Креатор указал' : 'Зафиксировано' }}</span>
          <span>{{ formatViews(video.views) }} просмотров · {{ formatMoney(video.payout) }}</span>
        </div>
      </section>

      <label v-if="video.status === 'SUBMITTED' || topupAt" class="views">
        <span class="section-title">{{ video.status === 'SUBMITTED' ? 'Просмотров по ссылке' : 'Итог просмотров' }}</span>
        <input v-model.number="views" type="number" inputmode="numeric" min="1" step="1" />
        <span v-if="estimate" class="hint">К начислению за эти просмотры: {{ estimate }} (не больше остатка бюджета)</span>
      </label>
      <label v-if="video.status === 'SUBMITTED' || topupAt" class="views">
        <span class="section-title">Лайков — по желанию, для отчёта рекламодателю</span>
        <input v-model.number="likes" type="number" inputmode="numeric" min="0" step="1" />
      </label>

      <template v-if="video.status === 'SUBMITTED'">
        <ReasonPicker v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
          <button type="button" class="approve" :disabled="busy || !views" @click="decide('approve')">Одобрить</button>
        </div>
      </template>
      <template v-else-if="topupAt && topupAt <= new Date()">
        <p class="hint">Добор закончился: откройте публикацию и зафиксируйте итог. Прирост доплатится, пока есть бюджет.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="bottom-bar">
          <button type="button" class="main-button" :disabled="busy || !views" @click="finalize">Зафиксировать итог</button>
        </div>
      </template>
      <p v-else-if="topupAt" class="hint">Одобрено. Итог просмотров — {{ formatDate(topupAt.toISOString()) }}.</p>
      <p v-else class="hint">Это видео уже проверено.</p>
    </template>
  </main>
</template>

<style scoped>
.rows {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--surface);
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 15px;
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.row span:first-child {
  color: var(--hint);
}
.views {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.views input {
  min-height: 48px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
.views input:focus {
  outline: none;
  border-color: var(--accent);
}
.head a {
  color: var(--link);
  font-weight: 600;
  text-decoration: none;
}
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
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
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.text {
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--surface);
  font-size: 15px;
  line-height: 1.45;
  white-space: pre-line;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.bottom-bar.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.bottom-bar button {
  height: 50px;
  border: none;
  border-radius: 12px;
  font-size: 17px;
  font-weight: 600;
}
.bottom-bar button:disabled {
  opacity: 0.5;
}
.reject {
  background: var(--danger);
  color: #fff;
}
.approve {
  background: #1e7b34;
  color: #fff;
}
</style>
