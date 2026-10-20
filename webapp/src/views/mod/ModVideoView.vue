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
import { formatCpm, formatDate, formatMoney, formatVideoFormat, formatViews, timeAgo } from '../../format';
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
          ✅ Автор подтверждён: {{ video.author.viaAccount ? 'ролик с подключённого аккаунта креатора' : video.author.name }}
        </template>
        <template v-else-if="video.author.status === 'mismatch'">
          ⚠ Автор —
          <a v-if="safeUrl(video.author.url)" :href="safeUrl(video.author.url)" target="_blank" rel="noopener noreferrer">{{ video.author.name || 'аккаунт' }}</a>,
          его нет в соцсетях креатора — проверьте, что ролик его
        </template>
        <template v-else>⚠ Авторство не проверено — сверьте аккаунт ролика с соцсетями креатора</template>
      </p>

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
        <ReasonPicker v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
          <button type="button" class="approve" :disabled="busy || !views" @click="decide('approve')">Одобрить</button>
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
  background: var(--success);
  color: #fff;
}
</style>
