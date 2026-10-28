import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { Account } from './advertiser/Account';
import { Help } from './advertiser/Help';
import { MyOrders } from './advertiser/MyOrders';
import { OrderForm } from './advertiser/OrderForm';
import { OrderReport } from './advertiser/OrderReport';
import { AllOrders } from './mod/AllOrders';
import { MyCabinet } from './mod/MyCabinet';
import { OrderPage } from './mod/OrderReview';
import { Payouts } from './mod/Payouts';
import { Queue } from './mod/Queue';
import { Stats } from './mod/Stats';
import { UserPage } from './mod/UserPage';
import { Users } from './mod/Users';
import { VideoPage } from './mod/VideoReview';
import { WhatWorks } from './mod/WhatWorks';
import { Balance } from './creator/Balance';
import { Learn } from './creator/Learn';
import { OrderPage as CreatorOrderPage } from './creator/OrderPage';
import { Profile } from './creator/Profile';
import { SubmitVideo } from './creator/SubmitVideo';
import { Submissions } from './creator/Submissions';
import { useSession } from './session';
import { Home, Shell } from './Shell';
import { Support } from './Support';

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
