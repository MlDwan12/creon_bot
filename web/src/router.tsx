import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { useSession } from './session';
import { Home, Shell } from './Shell';
import { Support } from './Support';

/**
 * Страницы кабинетов грузятся отдельными файлами при первом переходе: креатору не нужен код
 * модератора, заказчику — креатора. Каталог (главная креатора) — в основной сборке, через Shell.
 */
function page<M>(load: () => Promise<M>, name: keyof M) {
  return lazy(() =>
    load().then((m) => ({ default: m[name] as ComponentType })),
  );
}

const Account = page(() => import('./advertiser/Account'), 'Account');
const Help = page(() => import('./advertiser/Help'), 'Help');
const MyOrders = page(() => import('./advertiser/MyOrders'), 'MyOrders');
const OrderForm = page(() => import('./advertiser/OrderForm'), 'OrderForm');
const OrderReport = page(
  () => import('./advertiser/OrderReport'),
  'OrderReport',
);
const AllOrders = page(() => import('./mod/AllOrders'), 'AllOrders');
const MyCabinet = page(() => import('./mod/MyCabinet'), 'MyCabinet');
const OrderPage = page(() => import('./mod/OrderReview'), 'OrderPage');
const Payouts = page(() => import('./mod/Payouts'), 'Payouts');
const Queue = page(() => import('./mod/Queue'), 'Queue');
const Stats = page(() => import('./mod/Stats'), 'Stats');
const UserPage = page(() => import('./mod/UserPage'), 'UserPage');
const Users = page(() => import('./mod/Users'), 'Users');
const VideoPage = page(() => import('./mod/VideoReview'), 'VideoPage');
const WhatWorks = page(() => import('./mod/WhatWorks'), 'WhatWorks');
const Apply = page(() => import('./creator/Apply'), 'Apply');
const Balance = page(() => import('./creator/Balance'), 'Balance');
const Learn = page(() => import('./creator/Learn'), 'Learn');
const CreatorOrderPage = page(() => import('./creator/OrderPage'), 'OrderPage');
const Profile = page(() => import('./creator/Profile'), 'Profile');
const SubmitVideo = page(() => import('./creator/SubmitVideo'), 'SubmitVideo');
const Submissions = page(() => import('./creator/Submissions'), 'Submissions');

/** Окно модератора — только модераторам (права всё равно проверяет API). */
function ModOnly() {
  return useSession().me.isModerator ? <Outlet /> : <Navigate to="/" replace />;
}

// Адреса — как в мини-аппе (/mod/…): ссылки из истории и журнала (packages/shared/src/mod-labels.ts) общие.
export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      // кабинет заказчика — адреса как в мини-аппе
      { path: 'my-orders', element: <MyOrders /> },
      { path: 'my-orders/new', element: <OrderForm /> },
      { path: 'my-orders/:id/edit', element: <OrderForm /> },
      { path: 'my-orders/:id/report', element: <OrderReport /> },
      { path: 'help', element: <Help /> },
      { path: 'account', element: <Account /> },
      { path: 'support', element: <Support /> },
      // кабинет креатора (каталог — на главной) и профили — адреса как в мини-аппе
      { path: 'orders/:id', element: <CreatorOrderPage /> },
      { path: 'submissions', element: <Submissions /> },
      { path: 'submissions/:id/video', element: <SubmitVideo /> },
      { path: 'balance', element: <Balance /> },
      { path: 'learn', element: <Learn /> },
      { path: 'profile', element: <Profile /> },
      // «Стать заказчиком» — заявка и что с ней (APPLY_PATH в Shell.tsx)
      { path: 'profile/advertiser', element: <Apply /> },
      { path: 'creators/:id', element: <Profile /> },
      {
        path: 'mod',
        element: <ModOnly />,
        children: [
          { index: true, element: <Queue /> },
          { path: 'orders', element: <AllOrders /> },
          { path: 'orders/:id', element: <OrderPage /> },
          { path: 'videos/:id', element: <VideoPage /> },
          { path: 'users', element: <Users /> },
          { path: 'creators/:id', element: <UserPage /> },
          { path: 'payouts', element: <Payouts /> },
          { path: 'stats', element: <Stats /> },
          { path: 'what-works', element: <WhatWorks /> },
          { path: 'me', element: <MyCabinet /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
