<script setup lang="ts">
import { ref, watch } from 'vue';
import { closeOnboarding, onboardingOpen } from '../onboarding';

const slides = [
  {
    icon: '👋',
    title: 'Добро пожаловать в CreON',
    text: 'Рекламодатели заказывают здесь короткие видео, а креаторы снимают их и получают оплату. Можно быть и тем и другим.',
  },
  {
    icon: '🎬',
    title: 'Креаторам',
    steps: [
      'Выберите задание во вкладке «Заказы» и откликнитесь',
      'Снимите видео и пришлите ссылку в «Мои отклики»',
      'Модератор и рекламодатель проверят ролик',
      'После подтверждения команда CreON проведёт оплату',
    ],
  },
  {
    icon: '📢',
    title: 'Рекламодателям',
    steps: [
      'Во вкладке «Мои заказы» опишите задание и цену',
      'После проверки модератором заказ увидят креаторы',
      'Смотрите присланные ролики и принимайте подходящие',
    ],
  },
  {
    icon: '🔒',
    title: 'Всё через CreON',
    text: 'Стороны не видят контактов друг друга. Вопросы, споры и оплата — через поддержку: меню ⋯ → «Настройки».',
  },
];

const index = ref(0);
// Открыли заново ссылкой «Как это работает» — с первого слайда.
watch(onboardingOpen, (open) => open && (index.value = 0));

function next() {
  if (index.value < slides.length - 1) index.value++;
  else closeOnboarding();
}
</script>

<template>
  <div v-if="onboardingOpen" class="onboarding" role="dialog" aria-modal="true" aria-label="Как работает CreON">
    <button type="button" class="skip" @click="closeOnboarding">Пропустить</button>

    <section class="slide">
      <div class="icon" aria-hidden="true">{{ slides[index].icon }}</div>
      <h1>{{ slides[index].title }}</h1>
      <p v-if="slides[index].text">{{ slides[index].text }}</p>
      <ol v-else class="steps">
        <li v-for="s in slides[index].steps" :key="s">{{ s }}</li>
      </ol>
    </section>

    <div class="dots" aria-hidden="true">
      <span v-for="(_, i) in slides" :key="i" :class="{ active: i === index }" />
    </div>
    <div class="actions">
      <button v-if="index > 0" type="button" class="back" @click="index--">Назад</button>
      <button type="button" class="main-button" @click="next">
        {{ index < slides.length - 1 ? 'Далее' : 'Начать' }}
      </button>
    </div>
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
  padding: 12px 16px var(--safe-bottom);
  background: var(--bg);
  overflow-y: auto;
}
.skip {
  align-self: flex-end;
  min-height: 44px;
  padding: 0 8px;
  border: none;
  background: none;
  color: var(--hint);
  font-size: 15px;
}
.slide {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
  text-align: center;
}
.icon {
  font-size: 56px;
}
.slide h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.slide p {
  margin: 0;
  font-size: 16px;
  line-height: 1.45;
  color: var(--hint);
}
.steps {
  margin: 0;
  padding: 16px 16px 16px 36px;
  border-radius: 12px;
  background: var(--surface);
  text-align: left;
  font-size: 15px;
  line-height: 1.4;
}
.steps li + li {
  margin-top: 8px;
}
.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 20px 0 16px;
}
.dots span {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: var(--separator);
  transition: width 0.2s;
}
.dots .active {
  width: 18px;
  background: var(--accent);
}
.actions {
  display: flex;
  gap: 10px;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}
.back {
  flex: none;
  height: 50px;
  padding: 0 18px;
  border: none;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 17px;
  font-weight: 600;
}
</style>
