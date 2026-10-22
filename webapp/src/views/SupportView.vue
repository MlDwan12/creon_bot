<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, sendSupportMessage } from '../api';
import EmptyState from '../components/EmptyState.vue';
import { i18next } from '../i18n';

// /support?about=… — «Вопрос по заказу #12»: тема уходит менеджеру вместе с текстом.
const route = useRoute();
const router = useRouter();
const about = typeof route.query.about === 'string' ? route.query.about : '';

const text = ref('');
const busy = ref(false);
const error = ref('');
const sent = ref(false);

async function send() {
  busy.value = true;
  error.value = '';
  try {
    await sendSupportMessage(about ? `${about}\n\n${text.value}` : text.value);
    sent.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('support.sendError');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <EmptyState v-if="sent" :title="$t('support.sentTitle')" :text="$t('support.sentText')" role="status">
      <template #icon>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </template>
      <button type="button" class="main-button" @click="router.back()">{{ $t('common.done') }}</button>
    </EmptyState>

    <template v-else>
      <header class="head">
        <h1>{{ $t('support.title') }}</h1>
        <span class="hint">{{ $t('support.hint') }}</span>
      </header>
      <p v-if="about" class="topic">{{ about }}</p>
      <label class="field-label">
        <span>{{ $t('support.label') }}</span>
        <textarea v-model="text" rows="6" maxlength="1000" :placeholder="$t('support.placeholder')" />
      </label>
      <span class="counter" aria-hidden="true">{{ text.length }} / 1000</span>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="bottom-bar">
        <button type="button" class="main-button" :disabled="busy || !text.trim()" @click="send">
          {{ busy ? $t('common.sending') : $t('common.send') }}
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
}
.topic {
  align-self: flex-start;
  margin: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.counter {
  align-self: flex-end;
  margin-top: -10px;
  color: var(--hint);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
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
