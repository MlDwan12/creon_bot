import type {
  Feedback,
  MyOrder,
  NewOrderInput,
  OrderCategory,
  OrderReport,
  ReportTarget,
} from './api';
import type { Requester } from './mod-api';

/** Запросы кабинета заказчика — общие для мини-аппа и сайта. */
export function createAdvertiserApi(request: Requester) {
  return {
    fetchMyOrders: () => request<MyOrder[]>('GET', '/api/my-orders'),

    /** Сколько обычно стоят 1000 просмотров в категории, USDT; null — мало данных. */
    fetchPriceHint: (category: OrderCategory) =>
      request<{ per1000: number | null }>(
        'GET',
        `/api/my-orders/price-hint?category=${category}`,
      ),

    createOrder: (input: NewOrderInput) =>
      request<{ id: number }>('POST', '/api/my-orders', input),

    /** Правка заказа. `deadlineDays` не передан — срок не меняется, null — без срока. */
    updateOrder: (
      id: number,
      input: Omit<NewOrderInput, 'deadlineDays'> & {
        deadlineDays?: number | null;
      },
    ) => request<{ ok: true }>('PUT', `/api/my-orders/${id}`, input),

    closeOrder: (id: number) =>
      request<{ ok: true }>('POST', `/api/my-orders/${id}/close`),

    /** Продлить срок на `days` дней; истёкший заказ снова откроется. */
    extendOrder: (id: number, days: number) =>
      request<{ ok: true }>('POST', `/api/my-orders/${id}/extend`, { days }),

    deleteOrder: (id: number) =>
      request<{ ok: true }>('DELETE', `/api/my-orders/${id}`),

    fetchOrderReport: (orderId: number) =>
      request<OrderReport>('GET', `/api/my-orders/${orderId}/report`),

    /** Отчёт файлом CSV — придёт в чат с ботом. */
    sendReportCsv: (orderId: number) =>
      request<{ ok: true }>('POST', `/api/my-orders/${orderId}/report/csv`),

    /** `onModeration` — отзыв с текстом ушёл на проверку и появится в профиле креатора после неё. */
    rateVideo: (submissionId: number, feedback: Feedback) =>
      request<{ ok: true; onModeration: boolean }>(
        'POST',
        `/api/submissions/${submissionId}/rate`,
        feedback,
      ),
  };
}

/** Запросы, общие для обоих кабинетов: поддержка и жалобы. */
export function createAccountApi(request: Requester) {
  return {
    /** Сообщение менеджеру; ответ придёт в чат с ботом. */
    sendSupportMessage: (text: string) =>
      request<{ ok: true }>('POST', '/api/support', { text }),

    createReport: (report: {
      target: ReportTarget;
      targetId: number;
      reason: string;
      comment: string;
    }) => request<{ ok: true }>('POST', '/api/reports', report),
  };
}
