<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, fetchMySubmissions, type MySubmission, PLATFORM_NAMES, submitVideo } from '../api';
import PlatformIcon from '../components/PlatformIcon.vue';
import { describeVideoUrl, formatCpm, formatDeadline, formatMoney, formatViews } from '../format';

// `id` отклика приходит из адреса /submissions/:id/video.
const props = defineProps<{ id: string }>();

const submission = ref<MySubmission>();
const loadError = ref('');
const url = ref('');
// '' — поле пустое; v-model.number отдаёт '' для пустого ввода.
const views = ref<number | ''>('');
/** Сколько примерно начислят за указанные просмотры — если ставка уже есть. */
const estimate = computed(() => {
  const cpm = submission.value?.order.cpm;
  return cpm && views.value ? formatMoney(Math.floor((views.value * cpm) / 10) / 100) : '';
});
/** Распознанная ссылка — вместо длинного адреса показываем карточку ролика. */
const video = computed(() => {
  const d = describeVideoUrl(url.value);
  return d && d.platform !== 'OTHER' ? d : null;
});
const urlInput = ref<HTMLInputElement>();

/** «Изменить» в карточке — снова поле ввода, с курсором в нём. */
async function editUrl() {
  url.value = '';
  await nextTick();
  urlInput.value?.focus();
}

/** «Вставить ссылку»: из буфера, если Telegram разрешит; нет — курсор в поле, вставят сами. */
async function pasteUrl() {
  try {
    url.value = (await navigator.clipboard.readText()).trim();
  } catch {
    urlInput.value?.focus();
  }
}
const sending = ref(false);
const sendError = ref('');
const sent = ref(false);

async function load() {
  try {
    const found = (await fetchMySubmissions()).find((s) => s.id === Number(props.id));
    if (found?.status === 'IN_PROGRESS') submission.value = found;
    else loadError.value = 'Этот отклик уже отправлен или не найден.';
  } catch {
    loadError.value = 'Не удалось загрузить отклик';
  }
}

async function send() {
  sending.value = true;
  sendError.value = '';
  try {
    await submitVideo(Number(props.id), url.value, Number(views.value));
    sent.value = true;
  } catch (err) {
    // Проверку ссылки делает бэкенд — те же правила и тексты ошибок, что в боте.
    sendError.value = err instanceof ApiError ? err.userMessage : 'Не удалось отправить работу';
  } finally {
    sending.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>Отправка работы</h1>

    <p v-if="loadError" class="hint">
      {{ loadError }} <RouterLink to="/submissions">К моим откликам</RouterLink>
    </p>
    <p v-else-if="!submission" class="hint">Загрузка…</p>

    <template v-else-if="sent">
      <p class="notice" role="status">
        Ролик отправлен на проверку, оплата за порог просмотров зарезервирована. Когда модератор проверит ролик и зафиксирует просмотры, бот пришлёт уведомление.
      </p>
      <div class="bottom-bar">
        <RouterLink to="/submissions" class="main-button">К моим откликам</RouterLink>
      </div>
    </template>

    <template v-else>
      <div class="order">
        <div class="title">{{ submission.order.title }}</div>
        <div class="hint">
          {{ formatCpm(submission.order.cpm) }}
          <template v-if="submission.dueAt"> · сдать до {{ formatDeadline(submission.dueAt) }}</template>
        </div>
      </div>

      <!-- @submit.prevent — отправка формы без перезагрузки страницы (Enter на клавиатуре тоже работает). -->
      <form id="video-form" class="field" @submit.prevent="send">
        <label for="video-url" class="section-title">Ссылка на публикацию</label>
        <div v-if="video" class="video-card">
          <PlatformIcon :platform="video.platform" :size="48" />
          <span class="video-text">
            <strong>Ролик в {{ PLATFORM_NAMES[video.platform] }}</strong>
            <span>{{ video.short }}</span>
          </span>
          <button type="button" class="video-edit" @click="editUrl">Изменить</button>
        </div>
        <template v-else>
          <input
            id="video-url"
            ref="urlInput"
            v-model="url"
            type="url"
            inputmode="url"
            placeholder="https://…"
            autocomplete="off"
            required
          />
          <button v-if="!url" type="button" class="paste" @click="pasteUrl">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true">
              <rect x="6" y="4" width="12" height="17" rx="2.5" />
              <path d="M9 4.5V3h6v1.5" />
            </svg>
            Вставить ссылку
          </button>
        </template>
        <p class="hint help">
          Ролик, опубликованный у вас в TikTok, YouTube, VK, Instagram или X. Публикация должна быть открыта для всех.
          По YouTube просмотры посчитаем сами, по остальным площадкам — сверит модератор.
        </p>
        <label for="views" class="section-title">Просмотров сейчас</label>
        <input
          id="views"
          v-model.number="views"
          type="number"
          inputmode="numeric"
          :min="submission.order.minViews"
          step="1"
          :placeholder="`не меньше ${formatViews(submission.order.minViews)}`"
          required
        />
        <p class="hint help">
          Сдать можно от {{ formatViews(submission.order.minViews) }} просмотров.
          <template v-if="estimate">Примерно к начислению: {{ estimate }} — точную сумму посчитает модератор.</template>
        </p>
        <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
      </form>

      <section class="tips">
        <h2 class="section-title">Проверьте перед отправкой</h2>
        <ul>
          <li>Ролик соответствует заданию и требованиям к формату</li>
          <li>Публикация открыта для всех</li>
          <li>Число просмотров — как сейчас в публикации: модератор его сверит</li>
        </ul>
      </section>

      <div class="bottom-bar">
        <button type="submit" form="video-form" class="main-button" :disabled="sending || !url.trim() || !views">
          {{ sending ? 'Отправляем…' : 'Отправить на проверку' }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.order {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
input {
  min-height: 50px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 2px solid var(--separator);
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
}
input:focus {
  outline: none;
  border-color: var(--accent);
}
.video-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 2px solid var(--accent);
  border-radius: 18px;
  background: var(--surface);
}
.video-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--hint);
  overflow-wrap: anywhere;
}
.video-text strong {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}
.video-edit {
  flex: none;
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 12px;
  background: var(--fill);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.paste {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 52px;
  border: 2px dashed var(--accent);
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 16px;
  font-weight: 800;
}
.help {
  padding: 0 16px;
  line-height: 1.4;
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tips ul {
  margin: 0;
  padding: 12px 16px 12px 34px;
  border-radius: 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 16px;
}
.notice {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--success-soft);
  font-size: 15px;
  line-height: 1.4;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.hint a {
  color: var(--link);
}
.error {
  margin: 0;
  padding: 0 16px;
  font-size: 14px;
  color: var(--danger);
}
</style>
