<script setup lang="ts">
/**
 * Пустой экран или список: значок, заголовок, пояснение и действие (слот) — вместо строки серого
 * текста. Значок — слот `icon` (inline SVG), действие — слот по умолчанию.
 */
defineProps<{ title: string; text?: string }>();
</script>

<template>
  <section class="empty">
    <span class="icon" aria-hidden="true"><slot name="icon" /></span>
    <h2>{{ title }}</h2>
    <p v-if="text">{{ text }}</p>
    <slot />
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 20px;
  border-radius: var(--radius-card);
  background: var(--surface);
  text-align: center;
}
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 22px;
  background: var(--accent-soft);
  color: var(--link);
}
h2 {
  margin: 4px 0 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
}
p {
  max-width: 300px;
  margin: 0;
  color: var(--hint);
  font-size: 15px;
  line-height: 1.45;
}
/* действие — главная кнопка, но по ширине текста */
.empty :slotted(.main-button) {
  width: auto;
  margin-top: 6px;
  padding: 0 24px;
}
</style>
