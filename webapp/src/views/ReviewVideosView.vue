<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { acceptVideo, ApiError, fetchPendingVideos, type PendingVideos, rejectVideo } from '../api';
import { timeAgo } from '../format';
import { safeUrl } from '../telegram';

// `id` заказа из адреса /my-orders/:id/review.
const props = defineProps<{ id: string }>();

const data = ref<PendingVideos>();
const loadError = ref('');
const decided = ref(0);
const rejecting = ref(false);
const comment = ref('');
const busy = ref(false);
const error = ref('');

/** Смотрим по одному видео: после решения берём следующее из очереди. */
const current = computed(() => data.value?.items[0]);
const total = computed(() => decided.value + (data.value?.items.length ?? 0));

async function load() {
  try {
    data.value = await fetchPendingVideos(Number(props.id));
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить видео';
  }
}

async function decide(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    data.value!.items.shift();
    decided.value += 1;
    rejecting.value = false;
    comment.value = '';
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}

const accept = () => decide(() => acceptVideo(current.value!.id));
const reject = () => decide(() => rejectVideo(current.value!.id, comment.value));

void load();
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!data" class="hint">Загрузка…</p>

    <template v-else-if="!current">
      <h1>Всё рассмотрено</h1>
      <p class="hint">Новых видео по заказу «{{ data.order.title }}» нет. Бот сообщит, когда придут новые.</p>
      <div class="bottom-bar">
        <RouterLink to="/my-orders" class="main-button">К моим заказам</RouterLink>
      </div>
    </template>

    <template v-else>
      <header class="head">
        <span class="hint">{{ data.order.title }}</span>
        <h1>Видео ждёт решения</h1>
        <span v-if="total > 1" class="hint">{{ decided + 1 }} из {{ total }}</span>
      </header>

      <div class="creator">
        <div class="avatar" aria-hidden="true">{{ current.creator.replace('@', '').slice(0, 2).toUpperCase() }}</div>
        <div>
          <div class="name">{{ current.creator }}</div>
          <div class="hint">
            попытка {{ current.attempt }}<template v-if="current.submittedAt"> · прислано {{ timeAgo(current.submittedAt) }}</template>
          </div>
        </div>
      </div>

      <a v-if="safeUrl(current.videoUrl)" :href="safeUrl(current.videoUrl)" target="_blank" rel="noopener noreferrer" class="video">
        <span class="play" aria-hidden="true">▶</span>
        <span class="link">
          <span class="url">{{ current.videoUrl }}</span>
          <strong>Открыть видео</strong>
        </span>
      </a>
      <p v-else class="hint">Ссылка на видео некорректна: {{ current.videoUrl }}</p>

      <p class="checked">Модератор проверил ролик на соответствие заданию</p>

      <div v-if="rejecting" class="field">
        <label for="reason" class="section-title">Причина отклонения</label>
        <textarea id="reason" v-model="comment" rows="3" maxlength="500" placeholder="Что нужно исправить — креатор увидит этот текст" />
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="bottom-bar two">
        <template v-if="rejecting">
          <button type="button" class="secondary" :disabled="busy" @click="rejecting = false">Отмена</button>
          <button type="button" class="main-button danger" :disabled="busy || !comment.trim()" @click="reject">
            Отклонить
          </button>
        </template>
        <template v-else>
          <button type="button" class="secondary danger-text" :disabled="busy" @click="rejecting = true">
            Отклонить
          </button>
          <button type="button" class="main-button" :disabled="busy" @click="accept">Принять</button>
        </template>
      </div>
    </template>
  </main>
</template>

<style scoped>
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
.creator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background: var(--accent-soft);
  color: var(--link);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
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
.checked {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--success-soft);
  font-size: 15px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
textarea {
  box-sizing: border-box;
  padding: 12px 14px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  line-height: 1.4;
  resize: none;
}
textarea:focus {
  outline: none;
  border-color: var(--accent);
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
.secondary {
  height: 50px;
  border: none;
  border-radius: 12px;
  background: var(--fill);
  color: var(--text);
  font-size: 17px;
  font-weight: 600;
}
.danger-text {
  color: var(--danger);
}
.main-button.danger {
  background: var(--danger);
  color: #fff;
}
</style>
