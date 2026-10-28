import type {
  Balance,
  CreatorProfile,
  MySubmission,
  OrderCategory,
  OrderDetail,
  OrderSummary,
  SocialAccount,
  VideoPlatform,
} from './api';
import type { Requester } from './mod-api';

/** Запросы кабинета креатора и профилей — общие для мини-аппа и сайта. */
export function createCreatorApi(request: Requester) {
  return {
    /**
     * Страница каталога. `after` — последний показанный заказ (без него — первая страница).
     * hasMore — есть ли следующая; total — для заголовка, может отставать на полминуты.
     */
    fetchOpenOrders(
      after?: OrderSummary,
      category?: OrderCategory,
      platform?: VideoPlatform,
    ) {
      const query = new URLSearchParams();
      if (after) {
        query.set('afterId', String(after.id));
        query.set('afterCreatedAt', after.createdAt);
      }
      if (category) query.set('category', category);
      if (platform) query.set('platform', platform);
      return request<{
        items: OrderSummary[];
        hasMore: boolean;
        total: number;
        /** Только к первой странице: где есть открытые заказы (категории — с учётом площадки, и наоборот). */
        facets?: { categories: OrderCategory[]; platforms: VideoPlatform[] };
      }>('GET', `/api/orders?${query}`);
    },

    fetchOrder: (id: number) =>
      request<OrderDetail>('GET', `/api/orders/${id}`),

    claimOrder: (id: number) =>
      request<{ submissionId: number }>('POST', `/api/orders/${id}/claim`),

    fetchMySubmissions: () =>
      request<MySubmission[]>('GET', '/api/submissions'),

    /**
     * Сдать ролик. `acceptPayout` — креатор согласился на остаток фонда, который показал ответ
     * 409 OVER_BUDGET (overBudgetOf): просмотры вышли за рамки бюджета.
     * `bioLinkConfirmed` — ссылка стоит в шапке профиля, если заказ этого требует (order.linkInBio).
     */
    submitVideo: (
      submissionId: number,
      videoUrl: string,
      views: number,
      acceptPayout?: number,
      bioLinkConfirmed?: boolean,
    ) =>
      request<{ ok: true }>('POST', `/api/submissions/${submissionId}/video`, {
        videoUrl,
        views,
        acceptPayout,
        bioLinkConfirmed,
      }),

    fetchBalance: () => request<Balance>('GET', '/api/balance'),

    requestPayout: (amount: number) =>
      request<{ ok: true }>('POST', '/api/balance/withdraw', { amount }),

    fetchMyProfile: () => request<CreatorProfile>('GET', '/api/profile'),

    /** Профиль креатора; модератору — с блокировкой, кошельком и ссылками. */
    fetchCreator: (id: number) =>
      request<CreatorProfile>('GET', `/api/creators/${id}`),

    updateProfileLinks: (links: string[]) =>
      request<{ ok: true }>('PUT', '/api/profile/links', { links }),

    updateNotifications: (newOrders: boolean) =>
      request<{ ok: true }>('PUT', '/api/profile/notifications', { newOrders }),

    /** Пустая строка — убрать кошелёк. */
    updateWallet: (wallet: string) =>
      request<{ ok: true }>('PUT', '/api/profile/wallet', { wallet }),

    /** Пусто — ни одна площадка пока не подключается (нет ключей), раздел в профиле не показываем. */
    fetchSocialAccounts: () => request<SocialAccount[]>('GET', '/api/accounts'),

    /** Ссылка на вход на площадке — открыть во внешнем браузере. */
    connectSocialAccount: (platform: SocialAccount['platform']) =>
      request<{ url: string }>(
        'POST',
        `/api/accounts/${platform.toLowerCase()}/connect`,
      ),

    disconnectSocialAccount: (accountId: number) =>
      request<{ ok: true }>('DELETE', `/api/accounts/${accountId}`),
  };
}
