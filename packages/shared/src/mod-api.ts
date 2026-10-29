import type {
  ModFunnel,
  ModMe,
  ModOrder,
  ModOrderRow,
  ModPayout,
  ModQueue,
  ModReportGroup,
  ModStats,
  ModUserHistory,
  ModUserRow,
  ModUsersFilter,
  ModVideo,
  OrderStatus,
  Page,
  ReportTarget,
  WhatWorks,
} from './api';

/** Запрос к API со входом приложения: у мини-аппа — initData, у сайта — cookie сессии. */
export type Requester = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<T>;

/** Запросы окна модератора — общие для мини-аппа и сайта. */
export function createModApi(request: Requester) {
  return {
    fetchModQueue: () => request<ModQueue>('GET', '/api/mod/queue'),

    fetchModStats: () => request<ModStats>('GET', '/api/mod/stats'),

    /** Воронка за последние `days` дней; без аргумента — за всё время. */
    fetchModFunnel: (days?: number) =>
      request<ModFunnel>(
        'GET',
        `/api/mod/funnel${days ? `?days=${days}` : ''}`,
      ),

    fetchWhatWorks: (days?: number) =>
      request<WhatWorks>(
        'GET',
        `/api/mod/what-works${days ? `?days=${days}` : ''}`,
      ),

    fetchModUsers(search: string, filter: ModUsersFilter, page: number) {
      const query = new URLSearchParams({ search, filter, page: String(page) });
      return request<{ items: ModUserRow[]; total: number }>(
        'GET',
        `/api/mod/users?${query}`,
      );
    },

    fetchUserHistory: (userId: number) =>
      request<ModUserHistory>('GET', `/api/mod/users/${userId}/history`),

    fetchModMe: (days?: number) =>
      request<ModMe>('GET', `/api/mod/me${days ? `?days=${days}` : ''}`),

    /** Действия за период файлом CSV в чат с ботом: свои или всей команды. */
    sendModActionsCsv: (days: number | undefined, scope: 'me' | 'team') =>
      request<{ ok: true }>('POST', '/api/mod/me/csv', { days, scope }),

    /** statuses — фильтр по статусам; пусто — все. */
    fetchAllOrders(page: number, statuses: OrderStatus[] = []) {
      const status = statuses.length ? `&status=${statuses.join(',')}` : '';
      return request<Page<ModOrderRow>>(
        'GET',
        `/api/mod/orders?page=${page}${status}`,
      );
    },

    fetchModOrder: (id: number) =>
      request<ModOrder>('GET', `/api/mod/orders/${id}`),

    /**
     * `version` — из fetchModOrder: если рекламодатель успел изменить заказ, решение не пройдёт.
     * `cpm` — ставка за 1000 просмотров, USDT (только при одобрении).
     * `budgetConfirmed` — новый бюджет, USDT: модератор отметил, что доплата за повышение получена.
     */
    moderateOrder: (
      id: number,
      decision: 'approve' | 'reject',
      version: string,
      extra: { comment?: string; cpm?: number; budgetConfirmed?: number } = {},
    ) =>
      request<{ ok: true }>('POST', `/api/mod/orders/${id}/${decision}`, {
        version,
        ...extra,
      }),

    fetchModVideo: (id: number) =>
      request<ModVideo>('GET', `/api/mod/videos/${id}`),

    /**
     * Одобрить с просмотрами (`views`), отклонить с причиной (`comment`) или за завышенные просмотры
     * (`inflated` — тот же ролик больше не сдать).
     */
    moderateVideo: (
      id: number,
      decision: 'approve' | 'reject' | 'inflated',
      body: { views?: number; likes?: number | null; comment?: string },
    ) =>
      request<{ ok: true }>('POST', `/api/mod/videos/${id}/${decision}`, body),

    /** Итог холда: публикация на месте, просмотры — для отчёта. */
    finalizeVideo: (id: number, views: number, likes: number | null) =>
      request<{ ok: true }>('POST', `/api/mod/videos/${id}/finalize`, {
        views,
        likes,
      }),

    /**
     * При итоге публикации нет — начисление из холда отменяется.
     * bioLink — публикация на месте, но ссылку из шапки профиля убрали (заказ её требовал).
     */
    markPublicationDeleted: (id: number, bioLink = false) =>
      request<{ ok: true }>('POST', `/api/mod/videos/${id}/deleted`, {
        bioLink,
      }),

    fetchModPayouts: () => request<ModPayout[]>('GET', '/api/mod/payouts'),

    /** Отметить заявку выплаченной или отклонить с причиной — сумма вернётся на баланс. */
    decidePayout: (id: number, decision: 'paid' | 'reject', comment?: string) =>
      request<{ ok: true }>(
        'POST',
        `/api/mod/payouts/${id}/${decision}`,
        comment === undefined ? undefined : { comment },
      ),

    /** Опубликовать отзыв с проверки в профиле креатора. */
    approveReview: (submissionId: number) =>
      request<{ ok: true }>('POST', `/api/mod/reviews/${submissionId}/approve`),

    /** Удалить отзыв (оценку и текст) — опубликованный или с проверки. */
    removeReview: (submissionId: number) =>
      request<{ ok: true }>('DELETE', `/api/mod/reviews/${submissionId}`),

    fetchModReports: () => request<ModReportGroup[]>('GET', '/api/mod/reports'),

    /**
     * actioned — применить меру (закрыть заказ, убрать видео из портфолио, удалить отзыв, стереть ссылки).
     * banReason — ещё и заблокировать автора объекта.
     */
    resolveReports: (
      target: ReportTarget,
      targetId: number,
      actioned: boolean,
      banReason?: string,
    ) =>
      request<{ ok: true }>('POST', '/api/mod/reports/resolve', {
        target,
        targetId,
        actioned,
        banReason,
      }),

    /** final — без права обжалования; у заблокированного обычным баном — ужесточить. */
    banUser: (userId: number, reason: string, final = false) =>
      request<{ ok: true }>('POST', `/api/mod/users/${userId}/ban`, {
        reason,
        final,
      }),

    unbanUser: (userId: number) =>
      request<{ ok: true }>('POST', `/api/mod/users/${userId}/unban`),
  };
}
