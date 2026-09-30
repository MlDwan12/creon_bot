<script setup lang="ts">
import { safeUrl } from '../telegram';

/**
 * Уроки для креаторов. Ролики добавим позже: вставить ссылку в `videoUrl` — появится кнопка «Смотреть».
 * ponytail: список в коде, без админки — пока уроков несколько и меняются они редко.
 */
const LESSONS: { title: string; text: string; videoUrl: string | null }[] = [
  {
    title: 'Как взять заказ',
    text: 'Выберите задание в «Заказы»: смотрите ставку за 1000 просмотров, остаток бюджета и порог просмотров. Прочитайте описание и требования к ролику, нажмите «Откликнуться». На публикацию у вас 5 дней — потом слот сгорает.',
    videoUrl: null,
  },
  {
    title: 'Как снять ролик под требования',
    text: 'Смотрите ориентацию и длительность в карточке заказа и референс, если он есть. Ролик, который не подходит под требования, модератор отклонит.',
    videoUrl: null,
  },
  {
    title: 'Как сдать ролик и получить оплату',
    text: 'Опубликуйте ролик у себя в соцсети. Когда он наберёт порог просмотров, пришлите в «Мои отклики» ссылку и текущее число просмотров — оплата за них сразу резервируется. Модератор сверит просмотры и начислит деньги, а через 3 дня зафиксирует итог и доплатит за новые просмотры, пока в заказе есть бюджет. Публикация должна оставаться открытой.',
    videoUrl: null,
  },
  {
    title: 'Как вывести деньги',
    text: 'Начисления за ролики копятся на балансе: «Мои отклики» → «Баланс». Отправьте заявку на вывод от 100 ₽ — менеджер напишет вам в чате поддержки, уточнит реквизиты и переведёт деньги. Реквизиты в CreON не хранятся.',
    videoUrl: null,
  },
  {
    title: 'Правила площадки',
    text: 'Не оставляйте контакты в роликах и комментариях — общение и оплата идут через поддержку CreON. Чужие и перезалитые ролики не принимаются.',
    videoUrl: null,
  },
];
</script>

<template>
  <main class="learn">
    <header class="head">
      <h1>Обучение</h1>
      <p>Как работать с заказами и получать оплату</p>
    </header>

    <article v-for="(l, i) in LESSONS" :key="l.title" class="lesson">
      <h2>{{ i + 1 }}. {{ l.title }}</h2>
      <p>{{ l.text }}</p>
      <a v-if="safeUrl(l.videoUrl)" :href="safeUrl(l.videoUrl)" target="_blank" rel="noopener noreferrer" class="watch">
        Смотреть видео ›
      </a>
      <span v-else class="soon">Видеоурок скоро</span>
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
