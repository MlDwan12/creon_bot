<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  ApiError,
  type Feedback,
  fetchOrderReport,
  type OrderReport,
  PLATFORM_NAMES,
  rateVideo,
  sendReportCsv,
} from '../api';
import PlatformIcon from '../components/PlatformIcon.vue';
import SupportLink from '../components/SupportLink.vue';
import UserAvatar from '../components/UserAvatar.vue';
import LoadState from '../components/LoadState.vue';
import { formatDate, formatMoney, formatViews } from '../format';
import { i18next } from '../i18n';
import { safeUrl } from '../telegram';

// `id` заказа из адреса /my-orders/:id/review.
const props = defineProps<{ id: string }>();

const data = ref<OrderReport>();
/** Порядок роликов: по просмотрам (как отдаёт сервер) или новые первыми. */
const sort = ref<'views' | 'date'>('views');
const items = computed(() => {
  const list = data.value?.items ?? [];
  return sort.value === 'views'
    ? list
    : [...list].sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''));
});
/** Воронка полосами: открыли → взяли → одобрено; доля — от открывших карточку. */
const funnelBars = computed(() => {
  const f = data.value?.funnel;
  if (!f) return [];
  const pct = (n: number) => (f.viewers ? Math.round((n / f.viewers) * 100) : 0);
  return [
    { label: i18next.t('review.viewers'), value: f.viewers, percent: f.viewers ? 100 : 0, tone: '' },
    { label: i18next.t('review.taken'), value: f.taken, percent: pct(f.taken), tone: '' },
    { label: i18next.t('review.approvedShort'), value: f.approved, percent: pct(f.approved), tone: 'ok' },
  ];
});
const maxPlatformViews = computed(() => Math.max(0, ...(data.value?.platforms ?? []).map((p) => p.views)));

const csvState = ref<'idle' | 'sending' | 'sent'>('idle');
const csvError = ref('');

async function sendCsv() {
  csvState.value = 'sending';
  csvError.value = '';
  try {
    await sendReportCsv(Number(props.id));
    csvState.value = 'sent';
  } catch (err) {
    csvState.value = 'idle';
    csvError.value = err instanceof ApiError ? err.userMessage : i18next.t('review.csvError');
  }
}
const loadError = ref('');
/** Какой ролик сейчас оценивают — форма открыта только у него. */
const rating = ref<number>();
const feedback = reactive<Feedback>({ rating: 0, review: '', portfolioAllowed: false });
const busy = ref(false);
const error = ref('');
/** Ролики, чей отзыв только что ушёл на проверку, — подсказка под оценкой. */
const onModeration = ref(new Set<number>());

async function load() {
  loadError.value = '';
  try {
    data.value = await fetchOrderReport(Number(props.id));
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : i18next.t('review.loadError');
  }
}

function startRating(id: number) {
  rating.value = id;
  error.value = '';
  Object.assign(feedback, { rating: 0, review: '', portfolioAllowed: false });
}

async function rate() {
  busy.value = true;
  error.value = '';
  try {
    const { onModeration: queued } = await rateVideo(rating.value!, { ...feedback });
    if (queued) onModeration.value.add(rating.value!);
    const item = data.value!.items.find((i) => i.id === rating.value);
    if (item) item.rating = feedback.rating;
    rating.value = undefined;
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('review.error');
  } finally {
    busy.value = false;
  }
}

void load();
</script>

<template>
  <main class="page">
    <LoadState v-if="loadError || !data" :error="loadError" @retry="load" />

    <template v-else>
      <header class="head">
        <span class="hint">{{ data.order.title }}</span>
        <h1>{{ $t('review.title') }}</h1>
      </header>

      <section class="hero">
        <span class="money views">{{ formatViews(data.summary.views) }}</span>
        <span class="hint">{{ $t('review.viewsLikes', { likes: formatViews(data.summary.likes) }) }}</span>
        <div class="bar" aria-hidden="true">
          <span :style="{ width: `${Math.min(100, (data.summary.spent / data.summary.budget) * 100)}%` }" />
        </div>
        <span class="hint">
          <b>{{ formatMoney(data.summary.spent) }}</b> {{ $t('review.spentOf', { budget: formatMoney(data.summary.budget) })
          }}<template v-if="data.summary.reserved">{{ $t('review.reserved', { amount: formatMoney(data.summary.reserved) }) }}</template>
        </span>
      </section>
      <section class="kpis">
        <div><b>{{ data.summary.videos }}</b>{{ $t('review.videosCreators', { creators: data.summary.creators }) }}</div>
        <div><b>{{ data.summary.cpm === null ? '—' : formatMoney(data.summary.cpm) }}</b>{{ $t('review.perThousand') }}</div>
        <div v-if="data.summary.clicks !== null"><b>{{ formatViews(data.summary.clicks) }}</b>{{ $t('review.clicks') }}</div>
      </section>
      <p class="hint">{{ $t('review.left', { amount: formatMoney(data.summary.left) }) }}{{ $t('review.withFee') }}</p>

      <h2 class="section-title flush">{{ $t('review.funnel') }}</h2>
      <section class="bars">
        <div v-for="f in funnelBars" :key="f.label" class="bar-row">
          <span>{{ f.label }}</span>
          <b>{{ f.value }}</b>
          <div class="track" aria-hidden="true"><span :class="f.tone" :style="{ width: `${f.percent}%` }" /></div>
        </div>
        <p class="funnel-rest">
          {{ $t('review.onReviewShort', { count: data.funnel.onReview }) }} ·
          {{ $t('review.expiredShort', { count: data.funnel.expired }) }} ·
          {{ $t('review.rejectedShort', { count: data.funnel.rejected }) }}
        </p>
      </section>

      <article v-for="i in data.insights" :key="i.code" class="insight">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" />
        </svg>
        <p>{{ i.text }}</p>
      </article>

      <section v-if="data.platforms.length" class="bars">
        <div v-for="p in data.platforms" :key="p.platform" class="bar-row">
          <span class="platform"><PlatformIcon :platform="p.platform" :size="22" round />{{ PLATFORM_NAMES[p.platform] }}</span>
          <small class="right">{{ $t('review.platformViews', { videos: p.videos, views: formatViews(p.views) }) }}</small>
          <div class="track" aria-hidden="true">
            <span :style="{ width: `${maxPlatformViews ? (p.views / maxPlatformViews) * 100 : 0}%` }" />
          </div>
        </div>
      </section>

      <button type="button" class="secondary" :disabled="csvState !== 'idle'" @click="sendCsv">
        {{ csvState === 'sent' ? $t('review.csvSent') : csvState === 'sending' ? $t('common.sending') : $t('review.csv') }}
      </button>
      <p v-if="csvError" class="error" role="alert">{{ csvError }}</p>

      <div class="title-row">
        <h2 class="section-title flush">{{ $t('review.videos') }}</h2>
        <div class="segmented" role="radiogroup" :aria-label="$t('review.order')">
          <button type="button" role="radio" :aria-checked="sort === 'views'" @click="sort = 'views'">{{ $t('review.byViews') }}</button>
          <button type="button" role="radio" :aria-checked="sort === 'date'" @click="sort = 'date'">{{ $t('review.newest') }}</button>
        </div>
      </div>
      <p class="hint">
        {{ $t('review.hint') }}
      </p>

      <p v-if="data.items.length === 0" class="hint">{{ $t('review.empty') }}</p>

      <article v-for="item in items" :key="item.id" class="item">
        <RouterLink :to="`/creators/${item.creatorId}`" class="creator">
          <UserAvatar :user-id="item.creatorId" :name="item.creator" />
          <div class="who">
            <div class="name">{{ item.creator }}</div>
            <div class="hint">
              {{ PLATFORM_NAMES[item.platform] }} · {{ $t('review.itemViews', { views: formatViews(item.views) })
              }}<template v-if="item.likes !== null">{{ $t('review.itemLikes', { likes: formatViews(item.likes) }) }}</template
              ><template v-if="item.clicks !== null">{{ $t('review.itemClicks', { clicks: formatViews(item.clicks) }) }}</template
              ><template v-if="item.approvedAt">
                · {{ formatDate(item.approvedAt) }}</template
              >
            </div>
          </div>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>

        <a v-if="safeUrl(item.videoUrl)" :href="safeUrl(item.videoUrl)" target="_blank" rel="noopener noreferrer" class="video">
          <span class="play" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          </span>
          <span class="link">
            <span class="url">{{ item.videoUrl }}</span>
            <strong>{{ $t('review.open') }}</strong>
          </span>
        </a>
        <p v-else class="hint">{{ $t('review.badUrl', { url: item.videoUrl }) }}</p>

        <p v-if="item.rating" class="rated" :aria-label="$t('review.yourRating', { rating: item.rating })">
          {{ '★'.repeat(item.rating) }}{{ '☆'.repeat(5 - item.rating) }}
        </p>
        <p v-if="onModeration.has(item.id)" class="hint">
          {{ $t('review.thanks') }}
        </p>
        <fieldset v-else-if="rating === item.id" class="feedback">
          <legend class="section-title">{{ $t('review.rateTitle') }}</legend>
          <div class="stars" role="radiogroup" :aria-label="$t('review.rating')">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              role="radio"
              :aria-checked="feedback.rating === n"
              :aria-label="$t('review.outOf', { n })"
              :class="{ on: n <= feedback.rating }"
              @click="feedback.rating = n"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" />
              </svg>
            </button>
          </div>
          <label class="field-label">
            <span>{{ $t('review.reviewLabel') }}</span>
            <textarea
              v-model="feedback.review"
              rows="3"
              maxlength="500"
              :placeholder="$t('review.reviewPlaceholder')"
            />
          </label>
          <label class="check">
            <input v-model="feedback.portfolioAllowed" type="checkbox" />
            {{ $t('review.portfolio') }}
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="two">
            <button type="button" class="secondary" :disabled="busy" @click="rating = undefined">{{ $t('common.cancel') }}</button>
            <button type="button" class="main-button" :disabled="busy || !feedback.rating" @click="rate">
              {{ $t('review.rate') }}
            </button>
          </div>
        </fieldset>
        <!-- оценку не меняют (бэкенд не даст) — кнопка только у неоценённых -->
        <button v-else-if="!item.rating" type="button" class="secondary" @click="startRating(item.id)">
          {{ $t('review.rate') }}
        </button>

        <RouterLink
          :to="{ path: '/report', query: { target: 'VIDEO', id: item.id, title: $t('review.videoFrom', { name: item.creator }) } }"
          class="quiet-link"
        >
          {{ $t('review.reportVideo') }}
        </RouterLink>
      </article>

      <SupportLink
        :label="$t('order.supportLabel', { id: data.order.id })"
        :about="$t('order.supportAbout', { id: data.order.id, title: data.order.title })"
      />
    </template>
  </main>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
}
.views {
  font-size: 34px;
}
.hero .hint b {
  color: var(--text);
}
.bar {
  height: 8px;
  margin: 10px 0 2px;
  border-radius: 4px;
  background: var(--fill);
  overflow: hidden;
}
/* потрачено — лайм: это деньги */
.bar span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--lime);
}
.kpis {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 8px;
}
.kpis div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: 16px;
  background: var(--surface);
  color: var(--hint);
  font-size: 12px;
}
.kpis b {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 16px;
  white-space: nowrap;
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
}
.bar-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 10px;
  font-size: 14px;
}
.bar-row .right {
  color: var(--hint);
  font-size: 13px;
}
.platform {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.track {
  grid-column: 1 / -1;
  height: 8px;
  border-radius: 4px;
  background: var(--fill);
  overflow: hidden;
}
.track span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
}
.track span.ok {
  background: var(--success-text);
}
.funnel-rest {
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--separator);
  color: var(--hint);
  font-size: 13px;
}
.insight {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--link);
}
.insight svg {
  flex: none;
}
.insight p {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.45;
}
.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.flush {
  padding: 0;
}
.segmented {
  display: flex;
  padding: 2px;
  border-radius: 9px;
  background: var(--fill);
}
.segmented button {
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font-size: 13px;
}
.segmented button[aria-checked='true'] {
  background: var(--surface);
  font-weight: 600;
}
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
.head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--hint);
}
.item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--separator);
}
.creator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.who {
  flex: 1;
  min-width: 0;
}
.chevron {
  color: var(--hint);
  font-size: 22px;
}
.name {
  font-size: 16px;
  font-weight: 600;
}
.video {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.play {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--ink);
  color: var(--ink-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.url {
  font-size: 14px;
  color: var(--hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link strong {
  color: var(--link);
}
.rated {
  margin: 0;
  color: var(--accent);
  font-size: 22px;
}
.feedback {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: var(--surface);
}
.feedback legend {
  float: left;
  padding: 0;
}
.stars {
  display: flex;
  gap: 4px;
}
.stars button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: none;
  color: var(--separator);
}
/* фиолетовые звёзды: заметны в обеих темах (оранжевые на светлом фоне не дотягивали по контрасту) */
.stars button.on {
  color: var(--accent);
}
.feedback textarea {
  padding: 10px 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}
.check input {
  width: 20px;
  height: 20px;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.secondary {
  height: 50px;
  border: none;
  border-radius: 12px;
  background: var(--fill);
  color: var(--text);
  font-size: 17px;
  font-weight: 600;
}
</style>
