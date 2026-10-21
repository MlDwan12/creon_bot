<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import OnboardingOverlay from './components/OnboardingOverlay.vue';
import RoleSwitch from './components/RoleSwitch.vue';
import TabBar from './components/TabBar.vue';
import { banned, fetchMe } from './api';
import { i18next, setLang } from './i18n';
import { inTelegram, openTelegramLink, webApp } from './telegram';

const route = useRoute();

// Сменили язык — перерисовываем всё: так обновятся и тексты, и числа с датами из format.ts.
const lang = ref(i18next.language);
i18next.on('languageChanged', (l) => (lang.value = l));

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
    .then(({ supportUrl, isModerator, language }) => {
      // язык с сервера главнее догадки при запуске (выбран в профиле на другом устройстве)
      if (language !== i18next.language) setLang(language);
      if (!supportUrl) return;
      // форма в мини-аппе, а не переход в чат: так приложение не сворачивается
      const path = isModerator ? '/mod/support' : '/support';
      webApp!.SettingsButton.onClick(() => void router.push(path));
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
    {{ $t('common.back') }}
  </button>
  <main v-if="banned" class="banned">
    <div class="banned-icon" aria-hidden="true">🚫</div>
    <h1>{{ $t('banned.title') }}</h1>
    <p v-if="banned.reason">{{ $t('banned.reason', { reason: banned.reason }) }}</p>
    <p class="hint">{{ $t('banned.hint') }}</p>
    <button v-if="banned.supportUrl" type="button" class="main-button" @click="openTelegramLink(banned.supportUrl)">
      {{ $t('common.support') }}
    </button>
  </main>
  <template v-else>
    <!-- на главных экранах вкладок: «Креатор / Заказчик» (role.ts) -->
    <RoleSwitch v-if="route.meta.tab" :key="lang" />
    <RouterView :key="lang" />
  </template>
  <TabBar v-if="!banned" :key="lang" />
  <!-- matched пуст, пока роутер не решил, куда вести: иначе модератор мельком увидит онбординг. -->
  <OnboardingOverlay
    v-if="!banned && route.matched.length && !route.path.startsWith('/mod') && route.path !== '/privacy'"
  />
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
