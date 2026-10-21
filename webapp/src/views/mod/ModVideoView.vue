<script setup lang="ts">
import PlatformIcon from '../../components/PlatformIcon.vue';
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  ApiError,
  fetchModQueue,
  fetchModVideo,
  finalizeVideo,
  markPublicationDeleted,
  type ModVideo,
  moderateVideo,
  PLATFORM_NAMES,
} from '../../api';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { formatCpm, formatDate, formatMoney, formatViews, timeAgo, videoFormatParts } from '../../format';
import { confirmAction, safeUrl } from '../../telegram';

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

/** Нажали «Отклонить» — показываем причины; одобрить или отклонить без причины нельзя спутать. */
const rejecting = ref(false);
/** Сверка с требованиями заказа — памятка модератору, одобрить можно и без всех галочек. */
const checked = ref(new Set<string>());
function toggleCheck(item: string) {
  const next = new Set(checked.value);
  if (!next.delete(item)) next.add(item);
  checked.value = next;
}

async function load() {
  video.value = undefined;
  loadError.value = '';
  comment.value = '';
  rejecting.value = false;
  checked.value = new Set();
  try {
    video.value = await fetchModVideo(Number(props.id));
    // Просмотры из API площадки точнее заявленных — подставляем их.
    views.value = video.value.autoViews ?? video.value.views ?? '';
    likes.value = video.value.autoLikes ?? video.value.likes ?? '';
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить видео';
  }
}

/** После решения — следующее из той же очереди (проверка или итог холда); пуста — назад к ней. */
async function goNext(tab: 'videos' | 'holds') {
  const next = (await fetchModQueue().catch(() => undefined))?.[tab].find((v) => v.id !== Number(props.id));
  await router.replace(next ? `/mod/videos/${next.id}` : `/mod?tab=${tab}`);
}

async function run(action: () => Promise<unknown>, tab: 'videos' | 'holds') {
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
const finalize = () => run(() => finalizeVideo(Number(props.id), Number(views.value), likesOrNull()), 'holds');
async function deleted() {
  if (!(await confirmAction('Публикации нет по ссылке? Начисление за ролик отменится, деньги вернутся в бюджет заказа.')))
    return;
  await run(() => markPublicationDeleted(Number(props.id)), 'holds');
}

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
/** Когда кончается холд и можно зафиксировать итог; null — не одобрен или уже зафиксирован. */
const holdEndsAt = computed(() => {
  const v = video.value;
  if (!v || v.status !== 'MODERATOR_APPROVED' || v.finalizedAt || !v.decidedAt) return null;
  return new Date(new Date(v.decidedAt).getTime() + v.holdDays * 24 * 60 * 60 * 1000);
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
        <p v-if="video.order.termsBeforeEdit" class="hint">
          Ролик сдан до правки заказа — ниже прежние условия, проверяйте по ним.
        </p>
      </header>

      <a v-if="safeUrl(video.videoUrl)" :href="safeUrl(video.videoUrl)" target="_blank" rel="noopener noreferrer" class="video">
        <PlatformIcon :platform="video.platform" :size="48" inverse />
        <span class="link">
          <strong>Открыть ролик{{ video.platform !== 'OTHER' ? ` в ${PLATFORM_NAMES[video.platform]}` : '' }}</strong>
          <span class="url">{{ video.videoUrl }}</span>
        </span>
      </a>
      <p v-else class="hint">Ссылка на видео некорректна: {{ video.videoUrl }}</p>

      <p :class="['author', video.author.status]" :role="video.author.status === 'verified' ? undefined : 'alert'">
        <template v-if="video.author.status === 'verified'">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
          Автор подтверждён: {{ video.author.viaAccount ? 'ролик с подключённого аккаунта креатора' : video.author.name }}
        </template>
        <template v-else-if="video.author.status === 'mismatch'">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></svg>
          Автор —
          <a v-if="safeUrl(video.author.url)" :href="safeUrl(video.author.url)" target="_blank" rel="noopener noreferrer">{{ video.author.name || 'аккаунт' }}</a>,
          его нет в соцсетях креатора — проверьте, что ролик его
        </template>
        <template v-else>
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></svg>
          Авторство не проверено — сверьте аккаунт ролика с соцсетями креатора
        </template>
      </p>

      <section class="block">
        <h2 class="section-title">
          Сверьте с заданием<template v-if="videoFormatParts(video.order).length">
            · {{ checked.size }} из {{ videoFormatParts(video.order).length }}</template
          >
        </h2>
        <div v-if="videoFormatParts(video.order).length" class="checks">
          <label v-for="part in videoFormatParts(video.order)" :key="part" class="check">
            <input type="checkbox" :checked="checked.has(part)" @change="toggleCheck(part)" />
            <span>{{ part }}</span>
          </label>
        </div>
        <!-- текст задания длинный — свёрнут, требования выше видны сразу -->
        <details class="task" :open="!videoFormatParts(video.order).length">
          <summary>Текст задания</summary>
          <div class="text">{{ video.order.description }}</div>
        </details>
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

      <label v-if="video.status === 'SUBMITTED' || holdEndsAt" class="views">
        <span class="section-title">{{ video.status === 'SUBMITTED' ? 'Просмотров по ссылке' : 'Итог просмотров' }}</span>
        <input v-model.number="views" type="number" inputmode="numeric" min="1" step="1" />
        <span v-if="estimate" class="hint">К начислению за эти просмотры: {{ estimate }} (не больше остатка бюджета)</span>
      </label>
      <label v-if="video.status === 'SUBMITTED' || holdEndsAt" class="views">
        <span class="section-title">Лайков — по желанию, для отчёта рекламодателю</span>
        <input v-model.number="likes" type="number" inputmode="numeric" min="0" step="1" />
      </label>

      <template v-if="video.status === 'SUBMITTED'">
        <!-- причины — только когда решили отклонить: так «Отклонить» не нажать по ошибке -->
        <ReasonPicker v-if="rejecting" id="reasons" v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div v-if="rejecting" class="bottom-bar two">
          <button type="button" class="secondary" :disabled="busy" @click="rejecting = false">Отмена</button>
          <button type="button" class="reject-confirm" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
        </div>
        <div v-else class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy" @click="rejecting = true">Отклонить</button>
          <button type="button" class="approve" :disabled="busy || !views" @click="decide('approve')">
            Одобрить<template v-if="estimate"> · {{ estimate }}</template>
          </button>
        </div>
      </template>
      <template v-else-if="holdEndsAt && holdEndsAt <= new Date()">
        <p class="hint">
          Холд закончился: откройте публикацию и зафиксируйте итог — просмотры попадут в отчёт рекламодателю (оплата
          не меняется), а деньги за ролик станут доступны к выводу. Публикации нет — отмените начисление.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy" @click="deleted">Публикация удалена</button>
          <button type="button" class="approve" :disabled="busy || !views" @click="finalize">Зафиксировать итог</button>
        </div>
      </template>
      <p v-else-if="holdEndsAt" class="hint">Одобрено. Конец холда — {{ formatDate(holdEndsAt.toISOString()) }}.</p>
      <p v-else class="hint">Это видео уже проверено.</p>
    </template>
  </main>
</template>

<style scoped>
.author {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 14px;
  overflow-wrap: anywhere;
  background: var(--orange-soft);
  color: var(--orange-text);
}
.author.verified {
  background: var(--success-soft);
  color: var(--success-text);
}
.author a {
  color: inherit;
}
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
  border-radius: 20px;
  background: var(--ink);
  color: var(--ink-text);
  text-decoration: none;
}
.link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.url {
  font-size: 13px;
  color: var(--ink-hint);
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
  /* «Одобрить · 2,5 USDT» длиннее «Отклонить» — ей больше места, без переноса */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 10px;
}
.bottom-bar button {
  white-space: nowrap;
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
/* первый шаг отказа — спокойная кнопка, красная — только подтверждение с причиной */
.reject,
.secondary {
  background: var(--fill);
  color: var(--text);
}
.reject {
  color: var(--danger);
}
.reject-confirm {
  background: var(--danger);
  color: var(--accent-text);
}
.author {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.author .icon {
  flex: none;
  margin-top: 1px;
}
.checks {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  border-radius: 14px;
  background: var(--surface);
}
.check {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  font-size: 15px;
}
.check + .check {
  border-top: 1px solid var(--separator);
}
.check input {
  flex: none;
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--success);
}
.task summary {
  display: flex;
  align-items: center;
  min-height: 44px;
  color: var(--link);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.approve {
  background: var(--success);
  color: var(--accent-text);
}
</style>
