<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, createReport, reasonLabel, REPORT_REASONS, type ReportTarget } from '../api';
import EmptyState from '../components/EmptyState.vue';
import { i18next } from '../i18n';

// /report?target=ORDER&id=12&title=… — одна форма на все жалобы; title только для заголовка.
const route = useRoute();
const router = useRouter();

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
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('report.sendError');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <p v-if="!valid" class="hint">{{ $t('report.invalid') }}</p>

    <EmptyState v-else-if="sent" :title="$t('report.sentTitle')" :text="$t('report.sentText')" role="status">
      <template #icon>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </template>
      <button type="button" class="main-button" @click="router.back()">{{ $t('common.done') }}</button>
    </EmptyState>

    <template v-else>
      <header class="head">
        <h1>{{ $t(`report.heading.${target}`) }}</h1>
        <span v-if="title" class="hint">{{ title }}</span>
      </header>

      <fieldset class="reasons">
        <legend class="section-title">{{ $t('report.whatsWrong') }}</legend>
        <label v-for="r in reasons" :key="r" class="reason">
          <span>{{ reasonLabel(target, r) }}</span>
          <input v-model="reason" type="radio" name="reason" :value="r" />
        </label>
      </fieldset>

      <textarea
        v-model="comment"
        rows="3"
        maxlength="500"
        :required="reason === 'OTHER'"
        :aria-describedby="reason === 'OTHER' ? 'other-required' : undefined"
        :placeholder="reason === 'OTHER' ? $t('report.describe') : $t('report.commentOptional')"
      />
      <p v-if="reason === 'OTHER'" id="other-required" class="hint small">{{ $t('report.otherRequired') }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="bottom-bar">
        <button type="button" class="main-button" :disabled="!canSend" @click="send">
          {{ busy ? $t('common.sending') : $t('report.submit') }}
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
.hint.small {
  margin-top: -8px;
  font-size: 13px;
}
.reasons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: none;
}
.reasons legend {
  float: left;
  width: 100%;
  padding: 0 0 4px;
}
.reason {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 0 14px;
  border: 1.5px solid var(--separator);
  border-radius: 14px;
  background: var(--surface);
  font-size: 16px;
}
.reason:has(input:checked) {
  border-color: var(--accent);
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
