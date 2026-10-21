<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRouter } from 'vue-router';
import { role, roleLoaded, ROLE_HOME, setRole, type Role } from '../role';

/**
 * Первый вход: выбор кабинета (креатор или заказчик), потом короткие шаги для него и кнопка сразу
 * к делу. Показывается, пока роль не выбрана; дальше её меняет переключатель вверху экранов.
 */
const { t } = useTranslation();
/** Шаги роли — массив строк из словаря (onboarding.<роль>.steps). */
const steps = (r: Role) => t(`onboarding.${r}.steps`, { returnObjects: true }) as unknown as string[];

const router = useRouter();
/** Выбрана на первом шаге, но ещё не подтверждена: показываем её шаги. */
const picked = ref<Role>();
const open = computed(() => roleLoaded.value && (!role.value || !!picked.value));

/** Запомнить роль и перейти: заказчика с кнопки действия — сразу в форму заказа. */
function start(to: string) {
  setRole(picked.value!);
  picked.value = undefined;
  void router.push(to);
}
</script>

<template>
  <div v-if="open" class="onboarding" role="dialog" aria-modal="true" :aria-label="$t('onboarding.aria')">
    <div v-if="picked" class="top">
      <button type="button" class="link" @click="picked = undefined">{{ $t('onboarding.back') }}</button>
      <button type="button" class="link" @click="start(ROLE_HOME[picked])">{{ $t('onboarding.skip') }}</button>
    </div>

    <template v-if="!picked">
      <div class="brand">
        <img src="/logo.webp" alt="" width="128" height="128" />
        <span>Fixum</span>
      </div>
      <div class="intro">
        <h1>{{ $t('onboarding.title') }}</h1>
        <p>{{ $t('onboarding.intro') }}</p>
      </div>

      <button type="button" class="role advertiser" @click="picked = 'advertiser'">
        <span class="role-head">
          <span class="role-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          </span>
          <span class="role-label">{{ $t('onboarding.advertiserLabel') }}</span>
        </span>
        <strong>{{ $t('onboarding.advertiserTitle') }}</strong>
        <span class="role-text">{{ $t('onboarding.advertiserText') }}</span>
      </button>

      <button type="button" class="role creator" @click="picked = 'creator'">
        <span class="role-head">
          <span class="role-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M10 9.5v5l4.5-2.5z" />
            </svg>
          </span>
          <span class="role-label">{{ $t('onboarding.creatorLabel') }}</span>
        </span>
        <strong>{{ $t('onboarding.creatorTitle') }}</strong>
        <span class="role-text">{{ $t('onboarding.creatorText') }}</span>
      </button>
    </template>

    <template v-else>
      <div class="intro">
        <h1>{{ $t(`onboarding.${picked}.title`) }}</h1>
      </div>
      <ol class="steps">
        <li v-for="(s, i) in steps(picked)" :key="s">
          <span class="num" aria-hidden="true">{{ i + 1 }}</span>
          <span>{{ s }}</span>
        </li>
      </ol>
      <p class="note">
        {{ $t('onboarding.note') }}
      </p>
      <button
        type="button"
        class="main-button start"
        @click="start(picked === 'advertiser' ? '/my-orders/new' : ROLE_HOME.creator)"
      >
        {{ $t(`onboarding.${picked}.action`) }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.onboarding {
  position: fixed;
  inset: 0;
  /* Поверх вкладок и нижних кнопок экранов. */
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px 16px var(--safe-bottom);
  background: var(--bg);
  overflow-y: auto;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
}
.brand img {
  width: 128px;
  height: 128px;
  border-radius: 32px;
}
.brand span {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.6px;
}
.link {
  min-height: 44px;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--hint);
  font-size: 15px;
  font-weight: 600;
}
.intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.intro h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
}
.intro p {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--hint);
}
.role {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 20px;
  border: none;
  border-radius: 26px;
  text-align: left;
}
.role.advertiser {
  background: var(--accent);
  color: var(--accent-text);
}
.role.creator {
  background: var(--ink);
  color: var(--ink-text);
}
.role-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  align-self: stretch;
}
.role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: rgb(255 255 255 / 16%);
}
.creator .role-icon {
  background: var(--lime);
  color: var(--lime-text);
}
.role-label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  opacity: 0.8;
}
.role strong {
  font-size: 20px;
  font-weight: 800;
}
.role-text {
  font-size: 14px;
  line-height: 1.5;
  opacity: 0.85;
}
.steps {
  margin: 0;
  padding: 18px;
  border-radius: var(--radius-card);
  background: var(--surface);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.steps li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 15px;
  line-height: 1.45;
}
.num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 13px;
  font-weight: 800;
}
.note {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--hint);
}
.start {
  margin-top: auto;
}
</style>
