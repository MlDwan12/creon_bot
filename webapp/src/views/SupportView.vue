<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, sendSupportMessage } from '../api';
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
    <template v-if="sent">
      <h1>{{ $t('support.sentTitle') }}</h1>
      <p class="hint">{{ $t('support.sentText') }}</p>
      <div class="bottom-bar">
        <button type="button" class="main-button" @click="router.back()">{{ $t('common.done') }}</button>
      </div>
    </template>

    <template v-else>
      <header class="head">
        <h1>{{ $t('support.title') }}</h1>
        <span class="hint">{{ about || $t('support.hint') }}</span>
      </header>
      <textarea v-model="text" rows="6" maxlength="1000" :placeholder="$t('support.placeholder')" />
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
