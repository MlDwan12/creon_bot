<script setup lang="ts">
import { ref } from 'vue';
import { tList } from '../i18n';
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

/** Раскрыт один урок за раз — список короткий, видно все заголовки; -1 — все свёрнуты. */
const open = ref(0);
</script>

<template>
  <main class="learn">
    <header class="head">
      <h1>{{ $t('learn.title') }}</h1>
      <p>{{ $t('learn.subtitle') }}</p>
    </header>

    <section v-for="(l, i) in LESSONS" :key="l.key" class="lesson">
      <button
        :id="`lesson-${l.key}`"
        type="button"
        class="lesson-head"
        :aria-expanded="open === i"
        :aria-controls="`lesson-body-${l.key}`"
        @click="open = open === i ? -1 : i"
      >
        <span :class="['num', { on: open === i }]" aria-hidden="true">{{ i + 1 }}</span>
        <span class="lesson-title">{{ $t(`learn.lessons.${l.key}.title`) }}</span>
        <svg :class="['chevron', { up: open === i }]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div v-if="open === i" :id="`lesson-body-${l.key}`" class="lesson-body" role="region" :aria-labelledby="`lesson-${l.key}`">
        <ul class="keys">
          <li v-for="k in tList(`learn.lessons.${l.key}.keys`)" :key="k">{{ k }}</li>
        </ul>
        <p>{{ $t(`learn.lessons.${l.key}.text`) }}</p>
        <a v-if="safeUrl(l.videoUrl)" :href="safeUrl(l.videoUrl)" target="_blank" rel="noopener noreferrer" class="watch">
          {{ $t('learn.watch') }}
        </a>
      </div>
    </section>
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
  border-radius: 20px;
  background: var(--surface);
  overflow: hidden;
}
.lesson-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 12px 16px;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
}
.num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--link);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
}
.num.on {
  background: var(--accent);
  color: var(--accent-text);
}
.lesson-title {
  flex: 1;
  font-size: 16px;
  font-weight: 800;
}
.chevron {
  flex: none;
  color: var(--hint);
  transition: transform 0.2s;
}
.chevron.up {
  transform: rotate(180deg);
}
.lesson-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 16px 16px 60px;
}
.lesson-body p {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
}
/* ключевые цифры урока — лаймом, их видно, даже не читая текст */
.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.keys li {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  background: var(--lime);
  color: var(--lime-text);
  font-size: 13px;
  font-weight: 800;
}
.watch {
  align-self: flex-start;
  color: var(--link);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}
</style>
