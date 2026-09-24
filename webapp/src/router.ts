import { createRouter, createWebHistory } from 'vue-router';
import CatalogView from './views/CatalogView.vue';
import OrderDetailView from './views/OrderDetailView.vue';
import CreateOrderView from './views/CreateOrderView.vue';
import MyOrdersView from './views/MyOrdersView.vue';
import MySubmissionsView from './views/MySubmissionsView.vue';
import ReviewVideosView from './views/ReviewVideosView.vue';
import SubmitVideoView from './views/SubmitVideoView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Экран второго уровня: показываем «Назад» вместо нижних вкладок. */
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
    { path: '/my-orders', component: MyOrdersView },
    // ?from=<id> — «Исправить и отправить снова»: форма заполнена данными отклонённого заказа.
    { path: '/my-orders/new', component: CreateOrderView, meta: { back: true } },
    {
      path: '/my-orders/:id/review',
      component: ReviewVideosView,
      props: true,
      meta: { back: true },
    },
    { path: '/:rest(.*)', redirect: '/' },
  ],
});
