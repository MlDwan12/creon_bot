<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, sendSupportMessage } from '../api';

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
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось отправить';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <template v-if="sent">
      <h1>Сообщение отправлено</h1>
      <p class="hint">Менеджер ответит в чате с ботом CreON — там же можно продолжить разговор.</p>
      <div class="bottom-bar">
        <button type="button" class="main-button" @click="router.back()">Готово</button>
      </div>
    </template>

    <template v-else>
      <header class="head">
        <h1>Написать менеджеру</h1>
        <span class="hint">{{ about || 'Вопрос, проблема, оплата — ответим в чате с ботом' }}</span>
      </header>
      <textarea v-model="text" rows="6" maxlength="1000" placeholder="Ваше сообщение" />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="bottom-bar">
        <button type="button" class="main-button" :disabled="busy || !text.trim()" @click="send">
          {{ busy ? 'Отправляем…' : 'Отправить' }}
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
