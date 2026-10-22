<script setup lang="ts">
import { ref, watch } from 'vue';
import { fetchCreatorPhoto } from '../api';

/** Фото из Telegram; пока грузится или его нет — инициалы. */
const props = defineProps<{ userId: number; name: string; size?: number }>();

const photo = ref<string | null>(null);
watch(
  () => props.userId,
  async (id) => {
    photo.value = null;
    photo.value = await fetchCreatorPhoto(id);
  },
  { immediate: true },
);

// Креатор для заказчика — «Креатор А. · L6LW» (publicName на сервере): буква и код, иначе у всех «КР»
const ALIAS = /(?:(\p{L})\. )?· (\w)\w{3}$/u;
const initials = () => {
  const alias = props.name.match(ALIAS);
  if (alias) return `${alias[1] ?? ''}${alias[2]}`;
  return props.name.replace('@', '').slice(0, 2).toUpperCase();
};
</script>

<template>
  <div class="avatar" :style="{ width: `${size ?? 44}px`, height: `${size ?? 44}px` }" aria-hidden="true">
    <img v-if="photo" :src="photo" alt="" />
    <span v-else :style="{ fontSize: `${Math.round((size ?? 44) * 0.36)}px` }">{{ initials() }}</span>
  </div>
</template>

<style scoped>
.avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--link);
  font-weight: 700;
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
