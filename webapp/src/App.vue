<script setup lang="ts">
import { watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { banned, fetchMe } from './api';
import { inTelegram, openTelegramLink, webApp } from './telegram';

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
  // «⋯ → Настройки» в шапке Telegram ведёт в поддержку — на любом экране, не занимая места.
  void fetchMe()
    .then(({ supportUrl }) => {
      if (!supportUrl) return;
      webApp!.SettingsButton.onClick(() => openTelegramLink(supportUrl));
      webApp!.SettingsButton.show();
    })
    .catch(() => {});
  watch(
    () => route.meta.back,
    (back) => (back ? webApp!.BackButton.show() : webApp!.BackButton.hide()),
    { immediate: true },
  );
}
</script>

<template>
  <!-- В обычном браузере (dev) шапки Telegram нет — рисуем свою кнопку «Назад». -->
  <button v-if="!inTelegram && route.meta.back && !banned" type="button" class="browser-back" @click="goBack">
    ‹ Назад
  </button>
  <main v-if="banned" class="banned">
    <div class="banned-icon" aria-hidden="true">🚫</div>
    <h1>Аккаунт заблокирован</h1>
    <p v-if="banned.reason">Причина: {{ banned.reason }}</p>
    <p class="hint">Если это ошибка — напишите в поддержку.</p>
    <button v-if="banned.supportUrl" type="button" class="main-button" @click="openTelegramLink(banned.supportUrl)">
      Поддержка
    </button>
  </main>
  <RouterView v-else />
  <TabBar v-if="!banned" />
</template>

<style scoped>
.banned {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
}
.banned-icon {
  font-size: 48px;
}
.banned h1 {
  margin: 0;
  font-size: 24px;
}
.banned p {
  margin: 0;
  font-size: 16px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.banned .hint {
  color: var(--hint);
}
.banned .main-button {
  max-width: 320px;
  margin-top: 12px;
}
.browser-back {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  background: none;
  color: var(--link);
  font-size: 17px;
}
</style>
