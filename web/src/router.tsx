import { createBrowserRouter, Navigate, Outlet } from 'react-router';
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
import { useSession } from './session';
import { Home, Shell } from './Shell';

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
