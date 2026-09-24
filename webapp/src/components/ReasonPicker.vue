<script setup lang="ts">
import { ref } from 'vue';

// defineModel — значение, которое родитель связывает через v-model="comment" (двусторонняя связь).
const comment = defineModel<string>({ required: true });
defineProps<{ presets: string[] }>();

const textarea = ref<HTMLTextAreaElement>();

/** Готовая причина подставляется в текст — его можно дописать перед отправкой. «Другое» — пишем сами. */
function pick(preset: string | null) {
  comment.value = preset ?? '';
  if (!preset) textarea.value?.focus();
}
</script>

<template>
  <section class="reasons">
    <h2 class="section-title">Если отклоняете — причина</h2>
    <div class="chips">
      <button
        v-for="p in presets"
        :key="p"
        type="button"
        :aria-pressed="comment === p"
        @click="pick(p)"
      >
        {{ p }}
      </button>
      <button type="button" :aria-pressed="false" @click="pick(null)">Другое…</button>
    </div>
    <label class="visually-hidden" for="reason">Причина отклонения</label>
    <textarea
      id="reason"
      ref="textarea"
      v-model="comment"
      rows="2"
      maxlength="500"
      placeholder="Автор увидит этот текст"
    />
  </section>
</template>

<style scoped>
.reasons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chips button {
  min-height: 36px;
  padding: 0 14px;
  border: 2px solid transparent;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.chips button[aria-pressed='true'] {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-weight: 600;
}
textarea {
  box-sizing: border-box;
  padding: 10px 14px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  line-height: 1.4;
  resize: none;
}
textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
