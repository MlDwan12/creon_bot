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

/**
 * Тема обращения в поддержку: заказ или выплата. В адресе формы — только `?order=12` или
 * `?topic=payout`, не текстом: иначе чужая ссылка подставила бы свой текст в сообщение от имени
 * пользователя. Текст темы собирают по шаблону приложение (показать) и сервер (менеджеру).
 */
export type SupportAbout = { orderId: number } | { topic: 'payout' };

/** Адрес формы поддержки с темой. */
export function supportSearch(about: SupportAbout | null): string {
  if (!about) return '';
  return 'orderId' in about ? `?order=${about.orderId}` : '?topic=payout';
}

/** Тема из адреса формы поддержки; что-то другое — без темы. */
export function parseSupportAbout(q: URLSearchParams): SupportAbout | null {
  const order = q.get('order');
  if (order && /^[1-9]\d{0,9}$/.test(order)) return { orderId: Number(order) };
  return q.get('topic') === 'payout' ? { topic: 'payout' } : null;
}

/** Запросы, общие для обоих кабинетов: поддержка и жалобы. */
export function createAccountApi(request: Requester) {
  return {
    /** Сообщение менеджеру; ответ придёт в чат с ботом. Тему сервер подпишет сам. */
    sendSupportMessage: (text: string, about: SupportAbout | null = null) =>
      request<{ ok: true }>('POST', '/api/support', { text, ...about }),

    createReport: (report: {
      target: ReportTarget;
      targetId: number;
      reason: string;
      comment: string;
    }) => request<{ ok: true }>('POST', '/api/reports', report),
  };
}
