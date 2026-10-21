import { createRouter, createWebHistory, START_LOCATION } from 'vue-router';
import { fetchMe } from './api';
import { role, roleOfPath, roleReady, ROLE_HOME, setRole } from './role';
import AccountView from './views/AccountView.vue';
import HelpView from './views/HelpView.vue';
import BalanceView from './views/BalanceView.vue';
import CatalogView from './views/CatalogView.vue';
import OrderDetailView from './views/OrderDetailView.vue';
import PrivacyView from './views/PrivacyView.vue';
import ProfileView from './views/ProfileView.vue';
import ReportView from './views/ReportView.vue';
import SupportView from './views/SupportView.vue';
import CreateOrderView from './views/CreateOrderView.vue';
import LearnView from './views/LearnView.vue';
import ModAllOrdersView from './views/mod/ModAllOrdersView.vue';
import ModOrderView from './views/mod/ModOrderView.vue';
import ModPayoutsView from './views/mod/ModPayoutsView.vue';
import ModQueueView from './views/mod/ModQueueView.vue';
import ModStatsView from './views/mod/ModStatsView.vue';
import ModVideoView from './views/mod/ModVideoView.vue';
import MyOrdersView from './views/MyOrdersView.vue';
import MySubmissionsView from './views/MySubmissionsView.vue';
import ReviewVideosView from './views/ReviewVideosView.vue';
import SubmitVideoView from './views/SubmitVideoView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Экран второго уровня: показываем «Назад». */
    back?: boolean;
    /** Главный экран вкладки: сверху переключатель «Креатор / Заказчик». */
    tab?: boolean;
  }
}

// History-режим, а не hash: в hash Telegram кладёт параметры запуска (#tgWebAppData=…).
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CatalogView, meta: { tab: true } },
    {
      path: '/orders/:id',
      component: OrderDetailView,
      props: true,
      meta: { back: true },
    },
    { path: '/submissions', component: MySubmissionsView, meta: { tab: true } },
    { path: '/balance', component: BalanceView, meta: { back: true } },
    {
      path: '/submissions/:id/video',
      component: SubmitVideoView,
      props: true,
      meta: { back: true },
    },
    // Свой профиль креатора (без id) и чужой — рекламодателю, чьи видео он смотрел.
    { path: '/profile', component: ProfileView, meta: { tab: true } },
    {
      path: '/creators/:id',
      component: ProfileView,
      props: true,
      meta: { back: true },
    },
    // ?target=ORDER|VIDEO|REVIEW|PROFILE&id=…&title=… — одна форма на все жалобы.
    { path: '/report', component: ReportView, meta: { back: true } },
    // ?about=… — тема, например «Вопрос по заказу #12»
    { path: '/support', component: SupportView, meta: { back: true } },
    { path: '/my-orders', component: MyOrdersView, meta: { tab: true } },
    { path: '/learn', component: LearnView, meta: { tab: true } },
    // Кабинет заказчика: «Как это работает» и профиль (свой профиль креатора — /profile).
    { path: '/help', component: HelpView, meta: { tab: true } },
    { path: '/account', component: AccountView, meta: { tab: true } },
    // ?from=<id> — «Исправить и отправить снова»: форма заполнена данными отклонённого заказа.
    {
      path: '/my-orders/new',
      component: CreateOrderView,
      meta: { back: true },
    },
    // Правка своего заказа — та же форма, что и создание.
    {
      path: '/my-orders/:id/edit',
      component: CreateOrderView,
      props: true,
      meta: { back: true },
    },
    {
      path: '/my-orders/:id/review',
      component: ReviewVideosView,
      props: true,
      meta: { back: true },
    },
    // Отдельное окно модератора.
    { path: '/mod', component: ModQueueView },
    { path: '/mod/orders', component: ModAllOrdersView },
    { path: '/mod/stats', component: ModStatsView },
    { path: '/mod/payouts', component: ModPayoutsView, meta: { back: true } },
    {
      path: '/mod/orders/:id',
      component: ModOrderView,
      props: true,
      meta: { back: true },
    },
    // Та же форма поддержки в окне модератора (обычные страницы ему закрыты).
    { path: '/mod/support', component: SupportView, meta: { back: true } },
    // Тот же профиль в окне модератора — с удалением отзывов.
    {
      path: '/mod/creators/:id',
      component: ProfileView,
      props: true,
      meta: { back: true },
    },
    {
      path: '/mod/videos/:id',
      component: ModVideoView,
      props: true,
      meta: { back: true },
    },
    // Открывается и вне Telegram — ссылка на неё указана в BotFather.
    { path: '/privacy', component: PrivacyView, meta: { back: true } },
    { path: '/:rest(.*)', redirect: '/' },
  ],
});

// Модератора — в его окно, остальных — из него. Это только навигация:
// права на каждый /api/mod/* всё равно проверяет бэкенд (ModeratorGuard).
router.beforeEach(async (to, from) => {
  if (to.path === '/privacy') return;
  const { isModerator } = await fetchMe().catch(() => ({ isModerator: false }));
  const inModeration = to.path.startsWith('/mod');
  if (isModerator && !inModeration) return '/mod';
  if (!isModerator && inModeration) return '/';
  // Запуск с главной (кнопка меню, /start) — в кабинет, где пользователь был в прошлый раз.
  if (from === START_LOCATION && to.path === '/') {
    await roleReady;
    if (role.value === 'advertiser') return ROLE_HOME.advertiser;
  }
});

// Пришли на экран другого кабинета (ссылка из уведомления, переключатель) — переключаем и вкладки.
// Роль ещё не выбрана и открыли просто главную — не решаем за человека: спросит выбор роли.
router.afterEach((to) => {
  const r = roleOfPath(to.path);
  if (r && (role.value || to.path !== '/')) setRole(r);
});
