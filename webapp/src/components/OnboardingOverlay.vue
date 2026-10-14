<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { closeOnboarding, onboardingOpen } from '../onboarding';

type Role = 'advertiser' | 'creator';

/**
 * Приветствие: сначала выбор роли — бренд или креатор, потом короткие шаги для неё и кнопка сразу
 * к делу. Выбор ничего не запоминает: быть можно и тем и другим, вкладки внизу для обоих.
 */
const ROLES: Record<Role, { title: string; steps: string[]; action: string; to: string }> = {
  advertiser: {
    title: 'Как заказать рекламу',
    steps: [
      'Опишите задание и укажите бюджет',
      'Модератор проверит заказ и назначит ставку за 1000 просмотров',
      'Креаторы публикуют ролики у себя — вы платите только за просмотры',
      'Бюджет закончится — заказ закроется сам, сверх бюджета не потратите',
    ],
    action: 'Создать заказ',
    to: '/my-orders/new',
  },
  creator: {
    title: 'Как зарабатывать',
    steps: [
      'Выберите заказ и откликнитесь',
      'Опубликуйте ролик у себя в соцсети — на всё 7 дней',
      'Набрал порог просмотров — пришлите ссылку',
      'Модератор проверит ролик — начислим оплату, через 5 дней доплатим за новые просмотры',
    ],
    action: 'Смотреть заказы',
    to: '/',
  },
};

const router = useRouter();
const role = ref<Role>();
// Открыли заново ссылкой «Как это работает» — с выбора роли.
watch(onboardingOpen, (open) => open && (role.value = undefined));

function start() {
  const to = ROLES[role.value!].to;
  closeOnboarding();
  void router.push(to);
}
</script>

<template>
  <div v-if="onboardingOpen" class="onboarding" role="dialog" aria-modal="true" aria-label="Добро пожаловать в Fixum">
    <div class="top">
      <button v-if="role" type="button" class="link" @click="role = undefined">‹ Назад</button>
      <span v-else class="logo" aria-hidden="true">
        Fixum
        <span class="logo-bar"><span /></span>
      </span>
      <button type="button" class="link" @click="closeOnboarding">Пропустить</button>
    </div>

    <template v-if="!role">
      <div class="intro">
        <h1>Добро пожаловать</h1>
        <p>Что вы хотите сделать? Потом можно и то и другое — вкладки внизу.</p>
      </div>

      <button type="button" class="role advertiser" @click="role = 'advertiser'">
        <span class="role-head">
          <span class="role-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          </span>
          <span class="role-label">Брендам</span>
        </span>
        <strong>Заказать рекламу</strong>
        <span class="role-text">Задаёте бюджет — креаторы снимают ролики, вы платите только за набранные просмотры.</span>
      </button>

      <button type="button" class="role creator" @click="role = 'creator'">
        <span class="role-head">
          <span class="role-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M10 9.5v5l4.5-2.5z" />
            </svg>
          </span>
          <span class="role-label">Креаторам</span>
        </span>
        <strong>Зарабатывать на роликах</strong>
        <span class="role-text">Берёте заказ, публикуете в своём TikTok, Instagram или YouTube — получаете USDT за просмотры.</span>
      </button>
    </template>

    <template v-else>
      <div class="intro">
        <h1>{{ ROLES[role].title }}</h1>
      </div>
      <ol class="steps">
        <li v-for="(s, i) in ROLES[role].steps" :key="s">
          <span class="num" aria-hidden="true">{{ i + 1 }}</span>
          <span>{{ s }}</span>
        </li>
      </ol>
      <p class="note">
        Стороны не видят контактов друг друга: вопросы, споры и оплата — через поддержку (меню ⋯ → «Настройки»).
      </p>
      <button type="button" class="main-button start" @click="start">{{ ROLES[role].action }}</button>
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
.logo {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.8px;
  line-height: 1;
}
.logo-bar {
  height: 5px;
  border-radius: 3px;
  background: var(--separator);
}
.logo-bar span {
  display: block;
  width: 60%;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
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
