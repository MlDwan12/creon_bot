<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  ApiError,
  type Balance,
  banUser,
  connectSocialAccount,
  type CreatorProfile,
  disconnectSocialAccount,
  fetchBalance,
  fetchCreator,
  fetchMyProfile,
  fetchSocialAccounts,
  type SocialAccount,
  removeReview,
  unbanUser,
  updateNotifications,
  updateProfileLinks,
  updateWallet,
} from '../api';
import AppSettings from '../components/AppSettings.vue';
import PlatformIcon from '../components/PlatformIcon.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { describeVideoUrl, formatDate, formatMoney } from '../format';
import { i18next } from '../i18n';
import { confirmAction, openExternalLink, safeUrl } from '../telegram';

// Без id — свой профиль (/profile, ссылки можно редактировать); с id — чужой, только просмотр.
const props = defineProps<{ id?: string }>();
const route = useRoute();
/** В окне модератора (/mod/creators/:id) отзывы можно удалять. */
const moderator = route.path.startsWith('/mod');
const own = !props.id;

const profile = ref<CreatorProfile>();
const loadError = ref('');
const balance = ref<Balance>();
// баланс — второстепенное: не загрузился — просто не показываем
if (own) void fetchBalance().then((b) => (balance.value = b), () => {});

async function load() {
  try {
    profile.value = own ? await fetchMyProfile() : await fetchCreator(Number(props.id));
    links.value = [...profile.value.links];
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.loadError');
  }
}

// Ссылки на соцсети — списком: на одной площадке может быть несколько аккаунтов (до 10).
const MAX_LINKS = 10;
const links = ref<string[]>([]);
const newLink = ref('');
/** Площадка и короткий вид ссылки — для знака и подписи; не распознали — без знака. */
const linkView = (url: string) => describeVideoUrl(url) ?? { platform: 'OTHER' as const, short: url };
const shownLinks = computed(() => (profile.value?.links ?? []).filter((l) => safeUrl(l)));

function addLink() {
  const url = newLink.value.trim();
  if (url && !links.value.includes(url)) links.value.push(url);
  newLink.value = '';
}
function removeLink(i: number) {
  links.value.splice(i, 1);
}
function startLinks() {
  links.value = [...(profile.value?.links ?? [])];
  newLink.value = '';
  error.value = '';
  editing.value = true;
}

const editing = ref(false);
const busy = ref(false);
const error = ref('');

async function saveLinks() {
  busy.value = true;
  error.value = '';
  try {
    // недописанная ссылка в поле — тоже сохраняем, а не теряем молча
    await updateProfileLinks(newLink.value.trim() ? [...links.value, newLink.value.trim()] : links.value);
    editing.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.saveError');
  } finally {
    busy.value = false;
  }
}

// Кошелёк для выплат — только в своём профиле.
const editingWallet = ref(false);
const wallet = ref('');
const walletError = ref('');

function startWallet() {
  wallet.value = profile.value?.wallet ?? '';
  walletError.value = '';
  editingWallet.value = true;
}

async function saveWallet() {
  busy.value = true;
  walletError.value = '';
  try {
    await updateWallet(wallet.value);
    editingWallet.value = false;
    await load();
  } catch (err) {
    walletError.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.saveError');
  } finally {
    busy.value = false;
  }
}

// Подключённые аккаунты площадок — только в своём профиле. Пусто — ни одна площадка не включена.
const accounts = ref<SocialAccount[]>([]);
const accountsError = ref('');
const loadAccounts = () =>
  fetchSocialAccounts().then(
    (a) => (accounts.value = a),
    () => {},
  );
if (own) {
  void loadAccounts();
  // вход на площадке идёт во внешнем браузере — вернулись в Telegram, обновляем статус
  const onVisible = () => {
    if (document.visibilityState === 'visible') void loadAccounts();
  };
  document.addEventListener('visibilitychange', onVisible);
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
}

async function connectAccount(a: SocialAccount) {
  accountsError.value = '';
  try {
    openExternalLink((await connectSocialAccount(a.platform)).url);
  } catch (err) {
    accountsError.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.connectError');
  }
}

async function disconnectAccount(a: SocialAccount, account: SocialAccount['accounts'][number]) {
  const name = account.label ? `${a.name} ${account.label}` : a.name;
  if (!(await confirmAction(i18next.t('profile.disconnectConfirm', { name }))))
    return;
  accountsError.value = '';
  try {
    await disconnectSocialAccount(account.id);
    await loadAccounts();
  } catch (err) {
    accountsError.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.disconnectError');
  }
}

const notifyError = ref('');

async function toggleNewOrders(event: Event) {
  const input = event.target as HTMLInputElement;
  notifyError.value = '';
  try {
    await updateNotifications(input.checked);
    profile.value!.notifyNewOrders = input.checked;
  } catch (err) {
    input.checked = !input.checked;
    notifyError.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.saveError');
  }
}

async function remove(submissionId: number) {
  if (!(await confirmAction(i18next.t('profile.removeReviewConfirm')))) return;
  try {
    await removeReview(submissionId);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.removeReviewError');
  }
}

// Блокировка — только в окне модератора.
const banning = ref(false);
const banReason = ref('');

async function ban() {
  if (!(await confirmAction(i18next.t('profile.banConfirm')))) return;
  busy.value = true;
  error.value = '';
  try {
    await banUser(profile.value!.id, banReason.value);
    banning.value = false;
    banReason.value = '';
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.banError');
  } finally {
    busy.value = false;
  }
}

async function unban() {
  if (!(await confirmAction(i18next.t('profile.unbanConfirm')))) return;
  try {
    await unbanUser(profile.value!.id);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.userMessage : i18next.t('profile.unbanError');
  }
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

void load();
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="hint">{{ loadError }}</p>
    <p v-else-if="!profile" class="hint">{{ $t('common.loading') }}</p>

    <template v-else>
      <header class="head">
        <UserAvatar :user-id="profile.id" :name="profile.name" :size="72" />
        <div class="who">
          <span class="hint">{{ own ? $t('profile.mine') : $t('profile.creator') }}</span>
          <h1>{{ profile.name }}</h1>
        </div>
      </header>

      <section v-if="moderator" class="ban">
        <template v-if="profile.ban">
          <p><strong>{{ $t('profile.banned') }}</strong> {{ formatDate(profile.ban.at) }}<template v-if="profile.ban.reason">: {{ profile.ban.reason }}</template></p>
          <button type="button" class="edit" @click="unban">{{ $t('profile.unban') }}</button>
        </template>
        <template v-else-if="banning">
          <label class="field-label">
            <span>{{ $t('profile.banReasonLabel') }}</span>
            <textarea v-model="banReason" rows="2" maxlength="500" :placeholder="$t('profile.banReason')" />
          </label>
          <div class="buttons">
            <button type="button" :disabled="busy" @click="banning = false">{{ $t('common.cancel') }}</button>
            <button type="button" class="danger" :disabled="busy || !banReason.trim()" @click="ban">{{ $t('profile.ban') }}</button>
          </div>
        </template>
        <button v-else type="button" class="remove" @click="banning = true">{{ $t('profile.banUser') }}</button>
      </section>










      <!-- Свой профиль — тремя группами: деньги, что видят заказчики, настройки. Чужой — только витрина. -->
      <template v-if="own">
        <h2 class="group">{{ $t('profile.groupPayouts') }}</h2>
        <RouterLink v-if="balance" to="/balance" class="balance">
          <span>
            <small>{{ $t('submissions.balance') }}</small>
            <strong>{{ formatMoney(balance.available) }}</strong>
            <small v-if="balance.held">{{ $t('submissions.heldShort', { amount: formatMoney(balance.held) }) }}</small>
          </span>
          <span class="balance-action">{{ $t('submissions.withdraw') }}</span>
        </RouterLink>
        <section v-if="own" class="block">
          <h2 class="section-title">{{ $t('profile.walletTitle') }}</h2>
          <form v-if="editingWallet" class="links-form" @submit.prevent="saveWallet">
            <label>
              <span>{{ $t('profile.walletLabel') }}</span>
              <input
                v-model.trim="wallet"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                maxlength="64"
                placeholder="T…"
              />
            </label>
            <p class="hint">{{ $t('profile.walletHint') }}</p>
            <p v-if="walletError" class="error" role="alert">{{ walletError }}</p>
            <div class="buttons">
              <button type="button" :disabled="busy" @click="editingWallet = false">{{ $t('common.cancel') }}</button>
              <button type="submit" class="primary" :disabled="busy">{{ $t('common.save') }}</button>
            </div>
          </form>
          <template v-else-if="profile.wallet">
            <p class="wallet">{{ profile.wallet }}</p>
            <button type="button" class="edit" @click="startWallet">{{ $t('profile.walletChange') }}</button>
          </template>
          <!-- без кошелька вывести нельзя — заметно, с кнопкой, а не серой строкой -->
          <div v-else class="wallet-cta">
            <strong>{{ $t('profile.walletEmpty') }}</strong>
            <button type="button" class="main-button" @click="startWallet">{{ $t('profile.walletAddCta') }}</button>
          </div>
        </section>
      </template>

      <template v-if="own">
        <h2 class="group">{{ $t('profile.groupPublic') }}</h2>
        <p class="hint group-hint">{{ $t('profile.groupPublicHint') }}</p>
      </template>
      <div class="tiles">
        <div class="tile">
          <strong>{{ profile.rating ?? '—' }}</strong>
          <span>{{ profile.reviewsCount ? $t('profile.ratingReviews', { count: profile.reviewsCount }) : $t('profile.noReviewsYet') }}</span>
        </div>
        <div class="tile">
          <strong>{{ profile.completed }}</strong>
          <span>{{ $t('profile.approved') }}</span>
        </div>
      </div>
      <section class="block">
        <h2 class="section-title">{{ $t('profile.linksTitle') }}</h2>
        <form v-if="editing" class="links-form" @submit.prevent="saveLinks">
          <div v-for="(l, i) in links" :key="l" class="link-row">
            <PlatformIcon :platform="linkView(l).platform" :size="32" />
            <span class="link-text">{{ linkView(l).short }}</span>
            <button type="button" class="link-remove" :aria-label="$t('profile.removeLink')" @click="removeLink(i)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div v-if="links.length < MAX_LINKS" class="link-add">
            <label class="visually-hidden" for="new-link">{{ $t('profile.linkPlaceholder') }}</label>
            <input
              id="new-link"
              v-model="newLink"
              type="url"
              inputmode="url"
              autocomplete="off"
              :placeholder="$t('profile.linkPlaceholder')"
              @keydown.enter.prevent="addLink"
            />
            <button type="button" class="link-add-button" :disabled="!newLink.trim()" @click="addLink">
              {{ $t('profile.addLink') }}
            </button>
          </div>
          <p class="hint">{{ $t('profile.linksHint') }}</p>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="buttons">
            <button type="button" :disabled="busy" @click="editing = false">{{ $t('common.cancel') }}</button>
            <button type="submit" class="primary" :disabled="busy">{{ $t('common.save') }}</button>
          </div>
        </form>
        <template v-else>
          <div v-if="shownLinks.length" class="links">
            <a v-for="l in shownLinks" :key="l" :href="safeUrl(l)" target="_blank" rel="noopener noreferrer">
              <PlatformIcon :platform="linkView(l).platform" :size="24" round />
              {{ linkView(l).short }}
            </a>
          </div>
          <p v-else class="hint">{{ $t('profile.linksEmpty') }}</p>
          <button v-if="own" type="button" class="edit" @click="startLinks">
            {{ shownLinks.length ? $t('profile.linksChange') : $t('profile.linksAdd') }}
          </button>
        </template>
      </section>
      <section v-if="profile.portfolio.length" class="block">
        <h2 class="section-title">{{ $t('profile.portfolio') }}</h2>
        <!-- рекламодателю ссылки не приходят (ведут на аккаунт креатора) — только названия работ -->
        <template v-for="p in profile.portfolio" :key="p.submissionId">
          <a v-if="safeUrl(p.videoUrl)" :href="safeUrl(p.videoUrl)" target="_blank" rel="noopener noreferrer" class="item">
            <span class="play" aria-hidden="true">▶</span>
            <span>{{ p.orderTitle ?? $t('profile.otherOrder') }}</span>
          </a>
          <div v-else class="item">
            <span class="play done" aria-hidden="true">✓</span>
            <span>{{ p.orderTitle ?? $t('profile.otherOrder') }}</span>
          </div>
        </template>
      </section>
      <section class="block">
        <h2 class="section-title">{{ $t('profile.reviews') }}</h2>
        <p v-if="!profile.reviews.length" class="hint">{{ $t('profile.noReviews') }}</p>
        <article v-for="r in profile.reviews" :key="r.submissionId" class="review">
          <div class="review-top">
            <span class="stars" :aria-label="$t('profile.stars', { rating: r.rating })">{{ stars(r.rating) }}</span>
            <span v-if="r.decidedAt" class="hint">{{ formatDate(r.decidedAt) }}</span>
          </div>
          <p v-if="r.review" class="review-text">{{ r.review }}</p>
          <span class="hint">{{ r.orderTitle ?? $t('profile.otherOrder') }}</span>
          <button v-if="moderator" type="button" class="remove" @click="remove(r.submissionId)">
            {{ $t('profile.removeReview') }}
          </button>
          <RouterLink
            v-else-if="own"
            :to="{ path: '/report', query: { target: 'REVIEW', id: r.submissionId, title: r.orderTitle } }"
            class="quiet-link start"
          >
            {{ $t('profile.reportReview') }}
          </RouterLink>
        </article>
        <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>
      </section>

      <template v-if="own">
        <h2 class="group">{{ $t('profile.groupSettings') }}</h2>
        <section v-if="own && accounts.length" class="block">
          <h2 class="section-title">{{ $t('profile.accountsTitle') }}</h2>
          <p class="hint">{{ $t('profile.accountsHint') }}</p>
          <template v-for="a in accounts" :key="a.platform">
            <div v-for="acc in a.accounts" :key="acc.id" class="switch-row account-row">
              <PlatformIcon :platform="a.platform" :size="40" />
              <span>
                {{ a.name }}{{ acc.label ? ` · ${acc.label}` : '' }}
                <small>{{ $t('profile.connected') }}</small>
              </span>
              <button type="button" class="account-action quiet" @click="disconnectAccount(a, acc)">{{ $t('profile.disconnect') }}</button>
            </div>
            <div v-if="!a.accounts.length" class="switch-row account-row">
              <PlatformIcon :platform="a.platform" :size="40" />
              <span>
                {{ a.name }}
                <small>{{ $t('profile.notConnected') }}</small>
              </span>
              <button type="button" class="account-action" @click="connectAccount(a)">{{ $t('profile.connect') }}</button>
            </div>
            <button v-else-if="a.canAdd" type="button" class="add-account" @click="connectAccount(a)">
              {{ $t('profile.addAccount', { name: a.name }) }}
            </button>
          </template>
          <p v-if="accountsError" class="error" role="alert">{{ accountsError }}</p>
        </section>
        <section v-if="own" class="block">
          <h2 class="section-title">{{ $t('profile.notificationsTitle') }}</h2>
          <label class="switch-row">
            <span>
              {{ $t('profile.newOrders') }}
              <small>{{ $t('profile.newOrdersHint') }}</small>
            </span>
            <input type="checkbox" role="switch" :checked="profile.notifyNewOrders ?? true" @change="toggleNewOrders" />
          </label>
          <p v-if="notifyError" class="error" role="alert">{{ notifyError }}</p>
        </section>
        <AppSettings v-if="own" />
      </template>

      <RouterLink
        v-if="!own && !moderator"
        :to="{ path: '/report', query: { target: 'PROFILE', id: profile.id, title: profile.name } }"
        class="quiet-link"
      >
        {{ $t('profile.reportProfile') }}
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
/* Баланс — тёмная плашка с лаймовой суммой, как в макете. */
.balance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-radius: var(--radius-card);
  background: var(--ink);
  color: var(--ink-text);
  text-decoration: none;
}
.balance span:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.balance small {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-hint);
}
.balance strong {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--lime);
}
.balance-action {
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--lime);
  color: var(--lime-text);
  font-weight: 800;
}
.account-row > span {
  flex: 1;
}
.account-action {
  flex: none;
  min-height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: var(--fill);
  color: var(--link);
  font-size: 15px;
  font-weight: 600;
}
.add-account {
  align-self: flex-start;
  padding: 4px 2px;
  border: none;
  background: none;
  color: var(--link);
  font-size: 15px;
}
.account-action.quiet {
  color: var(--hint);
  font-weight: 400;
}
.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.switch-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.switch-row small {
  font-size: 13px;
  color: var(--hint);
}
/* нативный чекбокс в виде переключателя */
.switch-row input {
  flex: none;
  appearance: none;
  position: relative;
  width: 51px;
  height: 31px;
  margin: 0;
  border-radius: 16px;
  background: var(--fill);
  transition: background 0.2s;
}
.switch-row input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s;
}
.switch-row input:checked {
  background: var(--accent);
}
.switch-row input:checked::after {
  transform: translateX(20px);
}
.wallet {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
  font-family: ui-monospace, monospace;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.links a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  max-width: 100%;
  padding: 0 14px 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--link);
  font-weight: 600;
  text-decoration: none;
}
.edit {
  align-self: flex-start;
  min-height: 44px;
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
.link-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.link-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
}
.link-remove {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--fill);
  color: var(--hint);
}
.link-add {
  display: flex;
  gap: 8px;
}
.link-add input {
  flex: 1;
  min-width: 0;
}
.link-add-button {
  flex: none;
  min-height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 15px;
  font-weight: 700;
}
.link-add-button:disabled {
  opacity: 0.5;
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
  background: var(--ink);
  color: var(--ink-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.play.done {
  background: var(--success-soft);
  color: var(--success-text);
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
  color: var(--orange);
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
/* группы своего профиля: «Выплаты», «Публичный профиль», «Настройки» */
.group {
  margin: 12px 0 -4px;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
}
.group-hint {
  margin-top: -8px;
}
.wallet-cta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--orange-soft);
  color: var(--orange-text);
  font-size: 15px;
}
.wallet-cta .main-button {
  height: 48px;
  background: var(--orange);
  color: var(--lime-text);
}
.ban {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
}
.ban p {
  margin: 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.ban textarea {
  padding: 10px 12px;
  border: 1px solid var(--separator);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
.buttons .danger {
  background: var(--danger);
  color: var(--accent-text);
  font-weight: 600;
}
.remove {
  align-self: flex-start;
  min-height: 44px;
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
