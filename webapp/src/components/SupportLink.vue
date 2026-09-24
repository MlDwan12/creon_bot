<script setup lang="ts">
import { ref } from 'vue';
import { fetchMe } from '../api';
import { openTelegramLink } from '../telegram';

/** Ссылка «написать менеджеру» — открывает чат с ботом, сообщения оттуда уходят в поддержку. */
defineProps<{ label?: string }>();

const url = ref<string | null>(null);
fetchMe()
  .then((me) => (url.value = me.supportUrl))
  .catch(() => {});
</script>

<template>
  <button v-if="url" type="button" class="quiet-link" @click="openTelegramLink(url)">
    {{ label ?? 'Поддержка' }}
  </button>
</template>
