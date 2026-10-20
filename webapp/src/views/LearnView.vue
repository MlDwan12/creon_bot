<script setup lang="ts">
import { safeUrl } from '../telegram';

/**
 * Уроки для креаторов: тексты — в словаре (learn.lessons.<key>). Ролики добавим позже: вставить ссылку
 * в `videoUrl` — появится кнопка «Смотреть».
 * ponytail: список в коде, без админки — пока уроков несколько и меняются они редко.
 */
const LESSONS: { key: string; videoUrl: string | null }[] = [
  { key: 'take', videoUrl: null },
  { key: 'shoot', videoUrl: null },
  { key: 'submit', videoUrl: null },
  { key: 'timing', videoUrl: null },
  { key: 'withdraw', videoUrl: null },
  { key: 'rules', videoUrl: null },
];
</script>

<template>
  <main class="learn">
    <header class="head">
      <h1>{{ $t('learn.title') }}</h1>
      <p>{{ $t('learn.subtitle') }}</p>
    </header>

    <article v-for="(l, i) in LESSONS" :key="l.key" class="lesson">
      <h2>{{ i + 1 }}. {{ $t(`learn.lessons.${l.key}.title`) }}</h2>
      <p>{{ $t(`learn.lessons.${l.key}.text`) }}</p>
      <a v-if="safeUrl(l.videoUrl)" :href="safeUrl(l.videoUrl)" target="_blank" rel="noopener noreferrer" class="watch">
        {{ $t('learn.watch') }}
      </a>
      <span v-else class="soon">{{ $t('learn.soon') }}</span>
    </article>
  </main>
</template>

<style scoped>
.learn {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Снизу место под фиксированные вкладки. */
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head h1 {
  margin: 0 0 4px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.head p {
  margin: 0;
  font-size: 15px;
  color: var(--hint);
}
.lesson {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface);
}
.lesson h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.lesson p {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
}
.watch {
  align-self: flex-start;
  color: var(--link);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
.soon {
  font-size: 13px;
  color: var(--hint);
}
</style>
