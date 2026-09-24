<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, fetchMySubmissions, type MySubmission, submitVideo } from '../api';
import { formatDate, formatPrice } from '../format';

// `id` отклика приходит из адреса /submissions/:id/video.
const props = defineProps<{ id: string }>();

const submission = ref<MySubmission>();
const loadError = ref('');
const url = ref('');
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
    await submitVideo(Number(props.id), url.value);
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
        Работа отправлена на модерацию. Когда модератор и рекламодатель примут решение, бот пришлёт уведомление.
      </p>
      <div class="bottom-bar">
        <RouterLink to="/submissions" class="main-button">К моим откликам</RouterLink>
      </div>
    </template>

    <template v-else>
      <div class="order">
        <div class="title">{{ submission.order.title }}</div>
        <div class="hint">
          {{ formatPrice(submission.order.price) }}
          <template v-if="submission.order.deadline">
            · сдать до {{ formatDate(submission.order.deadline) }}
          </template>
        </div>
      </div>

      <!-- @submit.prevent — отправка формы без перезагрузки страницы (Enter на клавиатуре тоже работает). -->
      <form id="video-form" class="field" @submit.prevent="send">
        <label for="video-url" class="section-title">Ссылка на видео</label>
        <input
          id="video-url"
          v-model="url"
          type="url"
          inputmode="url"
          placeholder="https://…"
          autocomplete="off"
          required
        />
        <p class="hint help">
          Ролик в облаке или соцсети. Откройте доступ по ссылке, иначе модератор не сможет его посмотреть.
        </p>
        <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
      </form>

      <section class="tips">
        <h2 class="section-title">Проверьте перед отправкой</h2>
        <ul>
          <li>Видео соответствует заданию</li>
          <li>Все пункты задания выполнены</li>
          <li>Доступ по ссылке открыт</li>
        </ul>
      </section>

      <div class="bottom-bar">
        <button type="submit" form="video-form" class="main-button" :disabled="sending || !url.trim()">
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
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
input:focus {
  outline: none;
  border-color: var(--accent);
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
