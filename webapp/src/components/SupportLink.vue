<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { fetchMe } from '../api';

/** Ссылка «написать менеджеру» — форма в мини-аппе; `about` — тема, уйдёт вместе с сообщением. */
defineProps<{ label?: string; about?: string }>();

// null — поддержка не настроена (или это сам аккаунт поддержки)
const enabled = ref(false);
fetchMe()
  .then((me) => (enabled.value = Boolean(me.supportUrl)))
  .catch(() => {});
</script>

<template>
  <RouterLink v-if="enabled" :to="{ path: '/support', query: about ? { about } : {} }" class="quiet-link">
    {{ label ?? 'Поддержка' }}
  </RouterLink>
</template>
