import { createRouter, createWebHistory } from 'vue-router';
import { fetchMe } from './api';
import CatalogView from './views/CatalogView.vue';
import OrderDetailView from './views/OrderDetailView.vue';
import PrivacyView from './views/PrivacyView.vue';
import ProfileView from './views/ProfileView.vue';
import ReportView from './views/ReportView.vue';
import SupportView from './views/SupportView.vue';
import CreateOrderView from './views/CreateOrderView.vue';
import ModAllOrdersView from './views/mod/ModAllOrdersView.vue';
import ModOrderView from './views/mod/ModOrderView.vue';
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
  }
}

// History-режим, а не hash: в hash Telegram кладёт параметры запуска (#tgWebAppData=…).
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CatalogView },
    {
      path: '/orders/:id',
      component: OrderDetailView,
      props: true,
      meta: { back: true },
    },
    { path: '/submissions', component: MySubmissionsView },
    {
      path: '/submissions/:id/video',
      component: SubmitVideoView,
      props: true,
      meta: { back: true },
    },
    // Свой профиль креатора (без id) и чужой — рекламодателю, чьи видео он смотрел.
    { path: '/profile', component: ProfileView, meta: { back: true } },
    { path: '/creators/:id', component: ProfileView, props: true, meta: { back: true } },
    // ?target=ORDER|VIDEO|REVIEW|PROFILE&id=…&title=… — одна форма на все жалобы.
    { path: '/report', component: ReportView, meta: { back: true } },
    // ?about=… — тема, например «Вопрос по заказу #12»
    { path: '/support', component: SupportView, meta: { back: true } },
    { path: '/my-orders', component: MyOrdersView },
    // ?from=<id> — «Исправить и отправить снова»: форма заполнена данными отклонённого заказа.
    { path: '/my-orders/new', component: CreateOrderView, meta: { back: true } },
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
    {
      path: '/mod/orders/:id',
      component: ModOrderView,
      props: true,
      meta: { back: true },
    },
    // Та же форма поддержки в окне модератора (обычные страницы ему закрыты).
    { path: '/mod/support', component: SupportView, meta: { back: true } },
    // Тот же профиль в окне модератора — с удалением отзывов.
    { path: '/mod/creators/:id', component: ProfileView, props: true, meta: { back: true } },
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
router.beforeEach(async (to) => {
  if (to.path === '/privacy') return;
  const { isModerator } = await fetchMe().catch(() => ({ isModerator: false }));
  const inModeration = to.path.startsWith('/mod');
  if (isModerator && !inModeration) return '/mod';
  if (!isModerator && inModeration) return '/';
});
