<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  ApiError,
  fetchModQueue,
  fetchModReports,
  type ModQueue,
  type ModReportGroup,
  reasonLabel,
  type ReportTarget,
  resolveReports,
} from '../../api';
import { formatPrice, isWaitingLong, timeAgo, waitingFor } from '../../format';
import { confirmAction } from '../../telegram';

const route = useRoute();
const router = useRouter();

type Tab = 'orders' | 'videos' | 'reports';
// Вкладка — в адресе (?tab=videos), чтобы «Назад» из карточки вернул на ту же вкладку.
const tab = computed<Tab>(() =>
  route.query.tab === 'videos' || route.query.tab === 'reports' ? route.query.tab : 'orders',
);
const setTab = (t: Tab) => router.replace({ query: t === 'orders' ? {} : { tab: t } });

const reports = ref<ModReportGroup[]>([]);
const reportError = ref('');

/** Мера по жалобам — своя для каждого типа объекта (см. ReportsService.resolve). */
const ACTIONS: Record<ReportTarget, { label: string; confirm: string }> = {
  ORDER: { label: 'Закрыть заказ', confirm: 'Закрыть заказ? Рекламодатель и креаторы получат уведомление.' },
  VIDEO: { label: 'Убрать из портфолио', confirm: 'Убрать видео из портфолио креатора?' },
  REVIEW: { label: 'Удалить отзыв', confirm: 'Удалить отзыв? Оценка пропадёт из рейтинга.' },
  PROFILE: { label: 'Стереть ссылки', confirm: 'Стереть ссылки на соцсети в профиле?' },
};
const TARGET_NAMES: Record<ReportTarget, string> = {
  ORDER: 'Заказ',
  VIDEO: 'Видео',
  REVIEW: 'Отзыв',
  PROFILE: 'Профиль',
};

async function resolve(group: ModReportGroup, actioned: boolean) {
  const question = actioned
    ? ACTIONS[group.target].confirm
    : 'Нарушений нет? Жалобы закроются, авторам придёт ответ.';
  if (!(await confirmAction(question))) return;
  reportError.value = '';
  try {
    await resolveReports(group.target, group.targetId, actioned);
  } catch (err) {
    reportError.value = err instanceof ApiError ? err.userMessage : 'Не получилось, попробуйте ещё раз';
  }
  reports.value = await fetchModReports().catch(() => reports.value);
}

/** Куда вести модератора, чтобы посмотреть объект жалобы целиком. */
function subjectLink(g: ModReportGroup): string | null {
  if (!g.subject) return null;
  if (g.target === 'VIDEO') return `/mod/videos/${g.targetId}`;
  if (g.target === 'ORDER') return `/mod/orders/${g.targetId}`;
  return g.subject.profileId ? `/mod/creators/${g.subject.profileId}` : null;
}

const queue = ref<ModQueue>();
const error = ref('');

/** Самое старое ожидание в обеих очередях — главный сигнал «пора разбирать». */
const oldest = computed(() => {
  const dates = [
    ...(queue.value?.orders.map((o) => o.createdAt) ?? []),
    ...(queue.value?.videos.map((v) => v.submittedAt).filter((d): d is string => !!d) ?? []),
  ].sort();
  return dates[0];
});

async function load() {
  try {
    [queue.value, reports.value] = await Promise.all([fetchModQueue(), fetchModReports()]);
  } catch {
    error.value = 'Не удалось загрузить очередь';
  }
}

void load();
</script>

<template>
  <main class="page">
    <h1>Модерация</h1>

    <p v-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!queue" class="hint">Загрузка…</p>

    <template v-else>
      <div class="tiles">
        <div class="tile"><strong>{{ queue.orders.length }}</strong><span>заказов ждут</span></div>
        <div class="tile"><strong>{{ queue.videos.length }}</strong><span>видео ждут</span></div>
        <div class="tile" :class="{ warn: oldest && isWaitingLong(oldest) }">
          <strong>{{ oldest ? waitingFor(oldest) : '—' }}</strong><span>самое старое</span>
        </div>
      </div>

      <div class="segmented" role="tablist" aria-label="Очередь">
        <button type="button" role="tab" :aria-selected="tab === 'orders'" @click="setTab('orders')">
          Заказы · {{ queue.orders.length }}
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'videos'" @click="setTab('videos')">
          Видео · {{ queue.videos.length }}
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'reports'" @click="setTab('reports')">
          Жалобы · {{ reports.length }}
        </button>
      </div>

      <p class="hint">Сначала самые старые</p>

      <template v-if="tab === 'reports'">
        <p v-if="reports.length === 0" class="empty list">Жалоб нет.</p>
        <p v-if="reportError" class="error" role="alert">{{ reportError }}</p>
        <article v-for="g in reports" :key="`${g.target}:${g.targetId}`" class="report">
          <div class="report-top">
            <span class="badge">{{ TARGET_NAMES[g.target] }}</span>
            <span class="hint">жалоб: {{ g.reports.length }}</span>
          </div>

          <template v-if="g.subject">
            <RouterLink v-if="subjectLink(g)" :to="subjectLink(g)!" class="subject">
              {{ g.subject.title }} ›
            </RouterLink>
            <strong v-else class="subject">{{ g.subject.title }}</strong>
            <p v-if="g.subject.text" class="quote">{{ g.subject.text }}</p>
            <span class="hint">Автор: {{ g.subject.author }}</span>
          </template>
          <p v-else class="hint">Объект уже удалён.</p>

          <ul class="reasons">
            <li v-for="r in g.reports" :key="r.id">
              <strong>{{ reasonLabel(g.target, r.reason) }}</strong>
              <span v-if="r.comment"> — «{{ r.comment }}»</span>
              <span class="hint"> · {{ r.reporter }}, {{ timeAgo(r.createdAt) }}</span>
            </li>
          </ul>

          <div class="actions">
            <button type="button" @click="resolve(g, false)">Нарушений нет</button>
            <button v-if="g.subject" type="button" class="danger" @click="resolve(g, true)">
              {{ ACTIONS[g.target].label }}
            </button>
          </div>
        </article>
      </template>

      <div v-else-if="tab === 'orders'" class="list">
        <p v-if="queue.orders.length === 0" class="empty">Заказов на проверку нет.</p>
        <RouterLink v-for="o in queue.orders" :key="o.id" :to="`/mod/orders/${o.id}`" class="row">
          <span class="main">
            <span class="title">{{ o.title }}</span>
            <span class="sub">{{ o.advertiser }} · {{ formatPrice(o.price) }}</span>
          </span>
          <span :class="['wait', { long: isWaitingLong(o.createdAt) }]">{{ waitingFor(o.createdAt) }}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>
      </div>

      <div v-else class="list">
        <p v-if="queue.videos.length === 0" class="empty">Видео на проверку нет.</p>
        <RouterLink v-for="v in queue.videos" :key="v.id" :to="`/mod/videos/${v.id}`" class="row">
          <span class="main">
            <span class="title">{{ v.orderTitle }}</span>
            <span class="sub">{{ v.creator }}</span>
          </span>
          <span v-if="v.submittedAt" :class="['wait', { long: isWaitingLong(v.submittedAt) }]">
            {{ waitingFor(v.submittedAt) }}
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px calc(96px + var(--safe-bottom));
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface);
}
.tile strong {
  font-size: 24px;
}
.tile span {
  font-size: 13px;
  line-height: 1.25;
  color: var(--hint);
}
.tile.warn {
  background: color-mix(in srgb, #9a5200 14%, transparent);
}
.tile.warn strong,
.tile.warn span {
  color: #9a5200;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 2px;
  border-radius: 9px;
  background: var(--fill);
}
.segmented button {
  min-height: 34px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font-size: 14px;
}
.segmented button[aria-selected='true'] {
  background: var(--surface);
  font-weight: 600;
}
.report {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface);
}
.report-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.badge {
  padding: 3px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
}
.subject {
  color: var(--text);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}
a.subject {
  color: var(--link);
}
.quote {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--fill);
  font-size: 14px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.reasons {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions button {
  flex: 1;
  min-height: 44px;
  border: none;
  border-radius: 10px;
  background: var(--fill);
  color: var(--text);
  font-size: 15px;
}
.actions .danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-weight: 600;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
.list {
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 14px;
  color: var(--text);
  text-decoration: none;
}
.row + .row {
  border-top: 1px solid var(--separator);
}
.main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-grow: 1;
  min-width: 0;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.sub {
  font-size: 14px;
  color: var(--hint);
}
.wait {
  flex: none;
  font-size: 13px;
  color: var(--hint);
}
.wait.long {
  padding: 3px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, #9a5200 14%, transparent);
  color: #9a5200;
  font-weight: 600;
}
.chevron {
  color: var(--hint);
  font-size: 22px;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--hint);
}
.empty {
  margin: 0;
  padding: 16px;
  color: var(--hint);
}
</style>
