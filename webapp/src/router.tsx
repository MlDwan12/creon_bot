import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import AccountView from './views/AccountView';
import BalanceView from './views/BalanceView';
import CatalogView from './views/CatalogView';
import CreateOrderView from './views/CreateOrderView';
import HelpView from './views/HelpView';
import LearnView from './views/LearnView';
import ModAllOrdersView from './views/mod/ModAllOrdersView';
import ModMeView from './views/mod/ModMeView';
import ModUsersView from './views/mod/ModUsersView';
import ModOrderView from './views/mod/ModOrderView';
import ModPayoutsView from './views/mod/ModPayoutsView';
import ModQueueView from './views/mod/ModQueueView';
import ModStatsView from './views/mod/ModStatsView';
import ModVideoView from './views/mod/ModVideoView';
import ModWhatWorksView from './views/mod/ModWhatWorksView';
import MyOrdersView from './views/MyOrdersView';
import MySubmissionsView from './views/MySubmissionsView';
import OrderDetailView from './views/OrderDetailView';
import PrivacyView from './views/PrivacyView';
import ProfileView from './views/ProfileView';
import ReportView from './views/ReportView';
import ReviewVideosView from './views/ReviewVideosView';
import SubmitVideoView from './views/SubmitVideoView';
import SupportView from './views/SupportView';

/** handle экрана — App.tsx читает его через useMatches. */
export type RouteHandle = {
  /** Экран второго уровня: показываем «Назад». */
  back?: boolean;
  /** Главный экран вкладки: сверху переключатель «Креатор / Заказчик». */
  tab?: boolean;
};
const tab: RouteHandle = { tab: true };
const back: RouteHandle = { back: true };

// History-режим, а не hash: в hash Telegram кладёт параметры запуска (#tgWebAppData=…).
export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/', element: <CatalogView />, handle: tab },
      { path: '/orders/:id', element: <OrderDetailView />, handle: back },
      { path: '/submissions', element: <MySubmissionsView />, handle: tab },
      { path: '/balance', element: <BalanceView />, handle: back },
      {
        path: '/submissions/:id/video',
        element: <SubmitVideoView />,
        handle: back,
      },
      // Свой профиль креатора (без id) и чужой — рекламодателю, чьи видео он смотрел.
      { path: '/profile', element: <ProfileView />, handle: tab },
      { path: '/creators/:id', element: <ProfileView />, handle: back },
      // ?target=ORDER|VIDEO|REVIEW|PROFILE&id=…&title=… — одна форма на все жалобы.
      { path: '/report', element: <ReportView />, handle: back },
      // ?order=12 или ?topic=payout — тема (parseSupportAbout в packages/shared)
      { path: '/support', element: <SupportView />, handle: back },
      { path: '/my-orders', element: <MyOrdersView />, handle: tab },
      { path: '/learn', element: <LearnView />, handle: tab },
      // Кабинет заказчика: «Как это работает» и профиль (свой профиль креатора — /profile).
      { path: '/help', element: <HelpView />, handle: tab },
      { path: '/account', element: <AccountView />, handle: tab },
      // ?from=<id> — «Исправить и отправить снова»: форма заполнена данными отклонённого заказа.
      { path: '/my-orders/new', element: <CreateOrderView />, handle: back },
      // Правка своего заказа — та же форма, что и создание.
      {
        path: '/my-orders/:id/edit',
        element: <CreateOrderView />,
        handle: back,
      },
      {
        path: '/my-orders/:id/review',
        element: <ReviewVideosView />,
        handle: back,
      },
      // Отдельное окно модератора.
      { path: '/mod', element: <ModQueueView /> },
      { path: '/mod/orders', element: <ModAllOrdersView /> },
      // Статистика площадки — из «Я», поэтому с «Назад».
      { path: '/mod/stats', element: <ModStatsView />, handle: back },
      // Все пользователи — для банов и истории модерации.
      { path: '/mod/users', element: <ModUsersView /> },
      { path: '/mod/payouts', element: <ModPayoutsView /> },
      // Кабинет модератора: его решения, команда, выгрузка CSV.
      { path: '/mod/me', element: <ModMeView /> },
      { path: '/mod/what-works', element: <ModWhatWorksView />, handle: back },
      { path: '/mod/orders/:id', element: <ModOrderView />, handle: back },
      // Та же форма поддержки в окне модератора (обычные страницы ему закрыты).
      { path: '/mod/support', element: <SupportView />, handle: back },
      // Тот же профиль в окне модератора — с удалением отзывов.
      { path: '/mod/creators/:id', element: <ProfileView />, handle: back },
      { path: '/mod/videos/:id', element: <ModVideoView />, handle: back },
      // Открывается и вне Telegram — ссылка на неё указана в BotFather.
      { path: '/privacy', element: <PrivacyView />, handle: back },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
