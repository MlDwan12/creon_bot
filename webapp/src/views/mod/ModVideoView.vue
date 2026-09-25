<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, fetchModQueue, fetchModVideo, type ModVideo, moderateVideo } from '../../api';
import ReasonPicker from '../../components/ReasonPicker.vue';
import { timeAgo } from '../../format';
import { safeUrl } from '../../telegram';

const props = defineProps<{ id: string }>();
const router = useRouter();

const PRESETS = [
  'Не соответствует заданию',
  'Ссылка не открывается — проверьте доступ',
  'Низкое качество видео',
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
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить видео';
  }
}

/** После решения — следующее видео из очереди; очередь пуста — назад к ней (на вкладку «Видео»). */
async function goNext() {
  const next = (await fetchModQueue().catch(() => undefined))?.videos.find((v) => v.id !== Number(props.id));
  await router.replace(next ? `/mod/videos/${next.id}` : '/mod?tab=videos');
}

async function decide(decision: 'approve' | 'reject') {
  busy.value = true;
  error.value = '';
  try {
    await moderateVideo(Number(props.id), decision, decision === 'reject' ? comment.value : undefined);
    await goNext();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

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
      </section>

      <template v-if="video.status === 'SUBMITTED'">
        <ReasonPicker v-model="comment" :presets="PRESETS" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="bottom-bar two">
          <button type="button" class="reject" :disabled="busy || !comment.trim()" @click="decide('reject')">
            Отклонить
          </button>
          <button type="button" class="approve" :disabled="busy" @click="decide('approve')">Одобрить</button>
        </div>
      </template>
      <p v-else class="hint">Это видео уже проверено.</p>
    </template>
  </main>
</template>

<style scoped>
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
