import { createRouter, createWebHistory } from 'vue-router';
import CatalogView from './views/CatalogView.vue';
import OrderDetailView from './views/OrderDetailView.vue';
import MySubmissionsView from './views/MySubmissionsView.vue';
import SoonView from './views/SoonView.vue';
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
    { path: '/my-orders', component: SoonView },
    { path: '/:rest(.*)', redirect: '/' },
  ],
});
