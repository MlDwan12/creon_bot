<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, createReport, REPORT_REASONS, type ReportTarget } from '../api';

// /report?target=ORDER&id=12&title=… — одна форма на все жалобы; title только для заголовка.
const route = useRoute();
const router = useRouter();

const HEADINGS: Record<ReportTarget, string> = {
  ORDER: 'Жалоба на заказ',
  VIDEO: 'Жалоба на видео',
  REVIEW: 'Жалоба на отзыв',
  PROFILE: 'Жалоба на профиль',
};

const target = route.query.target as ReportTarget;
const targetId = Number(route.query.id);
const title = typeof route.query.title === 'string' ? route.query.title : '';
const valid = target in REPORT_REASONS && Number.isInteger(targetId);
const reasons = valid ? REPORT_REASONS[target] : [];

const reason = ref('');
const comment = ref('');
const busy = ref(false);
const error = ref('');
const sent = ref(false);

/** «Другое» без комментария бэкенд не примет — не даём и отправить. */
const canSend = computed(
  () => reason.value && (reason.value !== 'OTHER' || comment.value.trim()) && !busy.value,
);

async function send() {
  busy.value = true;
  error.value = '';
  try {
    await createReport({ target, targetId, reason: reason.value, comment: comment.value });
    sent.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось отправить жалобу';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <p v-if="!valid" class="hint">Непонятно, на что жалоба.</p>

    <template v-else-if="sent">
      <h1>Жалоба отправлена</h1>
      <p class="hint">Спасибо. Модератор проверит — результат придёт сообщением от бота.</p>
      <div class="bottom-bar">
        <button type="button" class="main-button" @click="router.back()">Готово</button>
      </div>
    </template>

    <template v-else>
      <header class="head">
        <h1>{{ HEADINGS[target] }}</h1>
        <span v-if="title" class="hint">{{ title }}</span>
      </header>

      <fieldset class="reasons">
        <legend class="section-title">Что не так</legend>
        <label v-for="r in reasons" :key="r.code" class="reason">
          <input v-model="reason" type="radio" name="reason" :value="r.code" />
          {{ r.label }}
        </label>
      </fieldset>

      <textarea
        v-model="comment"
        rows="3"
        maxlength="500"
        :placeholder="reason === 'OTHER' ? 'Опишите, что не так' : 'Комментарий — по желанию'"
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="bottom-bar">
        <button type="button" class="main-button" :disabled="!canSend" @click="send">
          {{ busy ? 'Отправляем…' : 'Отправить жалобу' }}
        </button>
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
  font-size: 15px;
  color: var(--hint);
  overflow-wrap: anywhere;
}
.reasons {
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.reasons legend {
  float: left;
  width: 100%;
  padding: 12px 14px 4px;
}
.reason {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  font-size: 16px;
}
.reason + .reason {
  border-top: 1px solid var(--separator);
}
.reason input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--accent);
}
textarea {
  padding: 10px 12px;
  border: 1px solid var(--separator);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
