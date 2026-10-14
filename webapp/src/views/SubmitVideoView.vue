<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, fetchMySubmissions, type MySubmission, PLATFORM_NAMES, submitVideo } from '../api';
import PlatformIcon from '../components/PlatformIcon.vue';
import { i18next, tList } from '../i18n';
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
    else loadError.value = i18next.t('submit.alreadySent');
  } catch {
    loadError.value = i18next.t('submit.loadError');
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
    sendError.value = err instanceof ApiError ? err.userMessage : i18next.t('submit.sendError');
  } finally {
    sending.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>{{ $t('submit.title') }}</h1>

    <p v-if="loadError" class="hint">
      {{ loadError }} <RouterLink to="/submissions">{{ $t('submit.toSubmissions') }}</RouterLink>
    </p>
    <p v-else-if="!submission" class="hint">{{ $t('common.loading') }}</p>

    <template v-else-if="sent">
      <p class="notice" role="status">
        {{ $t('submit.sent') }}
      </p>
      <div class="bottom-bar">
        <RouterLink to="/submissions" class="main-button">{{ $t('submit.toSubmissions') }}</RouterLink>
      </div>
    </template>

    <template v-else>
      <div class="order">
        <div class="title">{{ submission.order.title }}</div>
        <div class="hint">
          {{ formatCpm(submission.order.cpm) }}
          <template v-if="submission.dueAt">{{ $t('submit.dueAt', { date: formatDeadline(submission.dueAt) }) }}</template>
        </div>
      </div>

      <!-- @submit.prevent — отправка формы без перезагрузки страницы (Enter на клавиатуре тоже работает). -->
      <form id="video-form" class="field" @submit.prevent="send">
        <label for="video-url" class="section-title">{{ $t('submit.urlLabel') }}</label>
        <div v-if="video" class="video-card">
          <PlatformIcon :platform="video.platform" :size="48" />
          <span class="video-text">
            <strong>{{ $t('submit.videoIn', { platform: PLATFORM_NAMES[video.platform] }) }}</strong>
            <span>{{ video.short }}</span>
          </span>
          <button type="button" class="video-edit" @click="editUrl">{{ $t('submit.edit') }}</button>
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
            {{ $t('submit.paste') }}
          </button>
        </template>
        <p class="hint help">
          {{ $t('submit.urlHelp') }}
        </p>
        <label for="views" class="section-title">{{ $t('submit.viewsLabel') }}</label>
        <input
          id="views"
          v-model.number="views"
          type="number"
          inputmode="numeric"
          :min="submission.order.minViews"
          step="1"
          :placeholder="$t('submit.viewsPlaceholder', { views: formatViews(submission.order.minViews) })"
          required
        />
        <p class="hint help">
          {{ $t('submit.viewsHelp', { views: formatViews(submission.order.minViews) })
          }}<template v-if="estimate">{{ $t('submit.estimate', { amount: estimate }) }}</template>
        </p>
        <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
      </form>

      <section class="tips">
        <h2 class="section-title">{{ $t('submit.checkTitle') }}</h2>
        <ul>
          <li v-for="c in tList('submit.check')" :key="c">{{ c }}</li>
        </ul>
      </section>

      <div class="bottom-bar">
        <button type="submit" form="video-form" class="main-button" :disabled="sending || !url.trim() || !views">
          {{ sending ? $t('common.sending') : $t('submit.submit') }}
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
