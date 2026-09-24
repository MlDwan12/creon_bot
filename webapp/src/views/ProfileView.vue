<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  ApiError,
  type CreatorProfile,
  fetchCreator,
  fetchMyProfile,
  type ProfileLinks,
  removeReview,
  updateProfileLinks,
} from '../api';
import UserAvatar from '../components/UserAvatar.vue';
import { formatDate } from '../format';
import { confirmAction, safeUrl } from '../telegram';

// Без id — свой профиль (/profile, ссылки можно редактировать); с id — чужой, только просмотр.
const props = defineProps<{ id?: string }>();
const route = useRoute();
/** В окне модератора (/mod/creators/:id) отзывы можно удалять. */
const moderator = route.path.startsWith('/mod');
const own = !props.id;

const profile = ref<CreatorProfile>();
const loadError = ref('');

async function load() {
  try {
    profile.value = own ? await fetchMyProfile() : await fetchCreator(Number(props.id));
    Object.assign(links, profile.value.links);
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : 'Не удалось загрузить профиль';
  }
}

const NETWORKS: { field: keyof ProfileLinks; name: string; placeholder: string }[] = [
  { field: 'tiktokUrl', name: 'TikTok', placeholder: 'https://www.tiktok.com/@…' },
  { field: 'youtubeUrl', name: 'YouTube', placeholder: 'https://www.youtube.com/@…' },
  { field: 'vkUrl', name: 'VK', placeholder: 'https://vk.com/…' },
];
const links = reactive<ProfileLinks>({ tiktokUrl: null, youtubeUrl: null, vkUrl: null });
const filledLinks = computed(() =>
  NETWORKS.filter((n) => safeUrl(profile.value?.links[n.field] ?? null)),
);

const editing = ref(false);
const busy = ref(false);
const error = ref('');

async function saveLinks() {
  busy.value = true;
  error.value = '';
  try {
    await updateProfileLinks({ ...links });
    editing.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось сохранить';
  } finally {
    busy.value = false;
  }
}

async function remove(submissionId: number) {
  if (!(await confirmAction('Удалить отзыв? Оценка тоже пропадёт из рейтинга.'))) return;
  try {
    await removeReview(submissionId);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : 'Не удалось удалить отзыв';
  }
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

void load();
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!profile" class="hint">Загрузка…</p>

    <template v-else>
      <header class="head">
        <UserAvatar :user-id="profile.id" :name="profile.name" :size="72" />
        <div class="who">
          <span class="hint">{{ own ? 'Мой профиль креатора' : 'Профиль креатора' }}</span>
          <h1>{{ profile.name }}</h1>
        </div>
      </header>

      <div class="tiles">
        <div class="tile">
          <strong>{{ profile.rating ?? '—' }}</strong>
          <span>{{ profile.reviewsCount ? `рейтинг · отзывов: ${profile.reviewsCount}` : 'отзывов пока нет' }}</span>
        </div>
        <div class="tile">
          <strong>{{ profile.completed }}</strong>
          <span>видео принято</span>
        </div>
      </div>

      <section class="block">
        <h2 class="section-title">Соцсети</h2>
        <form v-if="editing" class="links-form" @submit.prevent="saveLinks">
          <label v-for="n in NETWORKS" :key="n.field">
            <span>{{ n.name }}</span>
            <input v-model.trim="links[n.field]" type="url" inputmode="url" :placeholder="n.placeholder" />
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="buttons">
            <button type="button" :disabled="busy" @click="editing = false">Отмена</button>
            <button type="submit" class="primary" :disabled="busy">Сохранить</button>
          </div>
        </form>
        <template v-else>
          <div v-if="filledLinks.length" class="links">
            <a
              v-for="n in filledLinks"
              :key="n.field"
              :href="safeUrl(profile.links[n.field])"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ n.name }}
            </a>
          </div>
          <p v-else class="hint">Ссылки не указаны.</p>
          <button v-if="own" type="button" class="edit" @click="editing = true">
            {{ filledLinks.length ? 'Изменить ссылки' : 'Добавить ссылки' }}
          </button>
        </template>
      </section>

      <section v-if="profile.portfolio.length" class="block">
        <h2 class="section-title">Портфолио</h2>
        <a
          v-for="p in profile.portfolio"
          :key="p.submissionId"
          :href="safeUrl(p.videoUrl)"
          target="_blank"
          rel="noopener noreferrer"
          class="item"
        >
          <span class="play" aria-hidden="true">▶</span>
          <span>{{ p.orderTitle }}</span>
        </a>
      </section>

      <section class="block">
        <h2 class="section-title">Отзывы</h2>
        <p v-if="!profile.reviews.length" class="hint">Отзывов пока нет.</p>
        <article v-for="r in profile.reviews" :key="r.submissionId" class="review">
          <div class="review-top">
            <span class="stars" :aria-label="`Оценка ${r.rating} из 5`">{{ stars(r.rating) }}</span>
            <span v-if="r.decidedAt" class="hint">{{ formatDate(r.decidedAt) }}</span>
          </div>
          <p v-if="r.review" class="review-text">{{ r.review }}</p>
          <span class="hint">{{ r.orderTitle }}</span>
          <button v-if="moderator" type="button" class="remove" @click="remove(r.submissionId)">
            Удалить отзыв
          </button>
          <RouterLink
            v-else-if="own"
            :to="{ path: '/report', query: { target: 'REVIEW', id: r.submissionId, title: r.orderTitle } }"
            class="quiet-link start"
          >
            Пожаловаться на отзыв
          </RouterLink>
        </article>
        <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>
      </section>

      <RouterLink
        v-if="!own && !moderator"
        :to="{ path: '/report', query: { target: 'PROFILE', id: profile.id, title: profile.name } }"
        class="quiet-link"
      >
        Пожаловаться на профиль
      </RouterLink>
    </template>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.who {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.tile strong {
  font-size: 26px;
}
.tile span {
  font-size: 13px;
  color: var(--hint);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block .section-title {
  padding: 0;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.links a {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--link);
  font-weight: 600;
  text-decoration: none;
}
.edit {
  align-self: flex-start;
  min-height: 36px;
  padding: 0;
  border: none;
  background: none;
  color: var(--link);
  font-size: 15px;
}
.links-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.links-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  color: var(--hint);
}
.links-form input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
.buttons {
  display: flex;
  gap: 8px;
}
.buttons button {
  flex: 1;
  min-height: 44px;
  border: none;
  border-radius: 10px;
  background: var(--fill);
  color: var(--text);
  font-size: 15px;
}
.buttons .primary {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.play {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #1c1c22;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.review {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.review-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.stars {
  color: #d99a00;
  font-size: 17px;
  letter-spacing: 1px;
}
.review-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.quiet-link.start {
  align-self: flex-start;
  padding: 0;
}
.remove {
  align-self: flex-start;
  min-height: 36px;
  padding: 0;
  border: none;
  background: none;
  color: var(--danger);
  font-size: 14px;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
