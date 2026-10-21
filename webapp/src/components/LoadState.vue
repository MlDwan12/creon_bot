<script setup lang="ts">
import EmptyState from './EmptyState.vue';

/**
 * Пока экран грузится — заготовки карточек; не загрузился — ошибка и «Повторить».
 * Экран сам решает, когда показывать (нет данных или есть ошибка), и по `retry` грузит заново.
 */
defineProps<{ error?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <EmptyState v-if="error" :title="$t('common.loadFailed')" :text="error" role="alert">
    <template #icon>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </template>
    <button type="button" class="main-button" @click="$emit('retry')">{{ $t('common.retry') }}</button>
  </EmptyState>
  <div v-else class="skeletons" role="status" :aria-label="$t('common.loading')">
    <div v-for="i in 3" :key="i" class="skeleton" aria-hidden="true">
      <span class="bone short"></span>
      <span class="bone"></span>
      <span class="bone mid"></span>
    </div>
  </div>
</template>

<style scoped>
.skeletons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
  animation: pulse 1.4s ease-in-out infinite;
}
.bone {
  height: 16px;
  border-radius: 8px;
  background: var(--fill);
}
.bone.short {
  width: 40%;
}
.bone.mid {
  width: 65%;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
