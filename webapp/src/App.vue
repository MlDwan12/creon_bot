<script setup lang="ts">
import { watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { inTelegram, webApp } from './telegram';

const route = useRoute();
const router = useRouter();

/** Назад по истории; если экран открыли сразу по ссылке (истории нет) — в каталог. */
function goBack() {
  if (window.history.state?.back) router.back();
  else router.push('/');
}

// Внутри Telegram «Назад» — его собственная кнопка в шапке (BackButton), а не наша.
if (inTelegram) {
  webApp!.BackButton.onClick(goBack);
  watch(
    () => route.meta.back,
    (back) => (back ? webApp!.BackButton.show() : webApp!.BackButton.hide()),
    { immediate: true },
  );
}
</script>

<template>
  <!-- В обычном браузере (dev) шапки Telegram нет — рисуем свою кнопку «Назад». -->
  <button v-if="!inTelegram && route.meta.back" type="button" class="browser-back" @click="goBack">
    ‹ Назад
  </button>
  <RouterView />
  <TabBar />
</template>

<style scoped>
.browser-back {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  background: none;
  color: var(--link);
  font-size: 17px;
}
</style>
