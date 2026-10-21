import { ref } from 'vue';
import { i18next, type Lang } from './i18n';
import { getInitData } from './telegram';

/** Аккаунт заблокирован — App.vue показывает экран блокировки вместо любого экрана. */
export const banned = ref<{ reason: string | null; supportUrl: string | null } | null>(null);

export type OrderCategory =
  | 'PRODUCT_REVIEW'
  | 'BEAUTY'
  | 'FOOD'
  | 'FASHION'
  | 'GAMING'
  | 'FITNESS'
  | 'ENTERTAINMENT'
  | 'TECH'
  | 'OTHER';

/** Категории заказа по порядку в фильтрах; названия — в словаре (i18n/*.json, categories). */
export const ORDER_CATEGORIES: OrderCategory[] = [
  'PRODUCT_REVIEW',
  'BEAUTY',
  'FOOD',
  'FASHION',
  'GAMING',
  'FITNESS',
  'ENTERTAINMENT',
  'TECH',
  'OTHER',
];

export function categoryLabel(code: OrderCategory): string {
  return i18next.t(`categories.${code}`);
}

/** Требования к ролику в заказе; null — любая длительность или ориентация, пустые platforms — любая площадка. */
export interface VideoFormat {
  minDurationSec: number | null;
  maxDurationSec: number | null;
  orientation: 'VERTICAL' | 'HORIZONTAL' | null;
  platforms: VideoPlatform[];
}

/** Ответ `GET /api/orders` — см. OrdersController и OrdersService на бэкенде. */
export interface OrderSummary extends VideoFormat {
  id: number;
  title: string;
  description: string;
  /** Ссылка на референс или материалы к заданию. */
  referenceUrl: string | null;
  /** Выплата креатору за 1000 просмотров, USDT. */
  cpm: number | null;
  /** Ролик можно сдать, когда он наберёт столько просмотров. */
  minViews: number;
  /** Сколько ещё осталось на выплаты креаторам, USDT. */
  free: number;
  /** Осталось меньше 30% фонда — подсвечиваем «успейте». */
  budgetLow: boolean;
  category: OrderCategory;
  deadline: string | null;
  createdAt: string;
}

/** Ответ `GET /api/orders/:id`. */
export interface OrderDetail extends OrderSummary {
  claimed: boolean;
  /** Заказ текущего пользователя — откликнуться нельзя. */
  own: boolean;
}

export type SubmissionStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'MODERATOR_APPROVED'
  | 'MODERATOR_REJECTED'
  /** Видео не прислали за 7 дней после отклика. */
  | 'SLOT_EXPIRED';

/** EXPIRED — закрыт по сроку (рекламодатель может продлить), CLOSED — закрыт им вручную. */
export type OrderStatus = 'PENDING_MODERATION' | 'OPEN' | 'REJECTED' | 'CLOSED' | 'EXPIRED' | 'EDIT_REJECTED';

/** Ответ `GET /api/submissions`: каждое видео — своя карточка. См. src/api/my-submissions.ts. */
export interface MySubmission {
  id: number;
  status: SubmissionStatus;
  /** Номер видео по этому заказу. */
  attempt: number;
  /** Самое новое видео по заказу — только по нему предлагаем прислать новое после отказа. */
  latest: boolean;
  videoUrl: string | null;
  comment: string | null;
  createdAt: string;
  submittedAt: string | null;
  /** Когда модератор одобрил или отклонил. */
  decidedAt: string | null;
  /** Одобрен, итога ещё нет — до когда холд (потом деньги можно вывести). */
  holdEndsAt: string | null;
  /** До когда прислать видео (только «в работе»): конец слота или срок заказа, что раньше. */
  dueAt: string | null;
  /** На проверке — заявлено креатором, после одобрения — зафиксировано модератором. */
  views: number | null;
  /** USDT: на проверке — зарезервировано, после одобрения — начислено. */
  payout: number;
  /** Холд закончился: итог зафиксирован, деньги можно вывести. */
  finalized: boolean;
  /** Ссылка на товар для описания ролика — путь `/r/<код>` от адреса мини-аппа; null — у заказа нет товара. */
  trackPath: string | null;
  /** VideoFormat — требования к ролику, для самопроверки перед сдачей. */
  order: VideoFormat & {
    id: number;
    title: string;
    cpm: number | null;
    minViews: number;
    deadline: string | null;
    status: OrderStatus;
  };
}

/** Ответ `GET /api/my-orders` — см. src/api/my-orders.controller.ts. */
export interface MyOrder extends VideoFormat {
  id: number;
  title: string;
  description: string;
  referenceUrl: string | null;
  targetUrl: string | null;
  /** Весь бюджет, USDT. */
  budget: number;
  minViews: number;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  rejectReason: string | null;
  /** Опубликованный заказ изменён, правку ещё не одобрили: ролики не сдают, можно исправить или закрыть. */
  frozen: boolean;
  /** Сколько бюджета израсходовано и зарезервировано, %. */
  usedPercent: number;
  /** Одобренных роликов и сумма их просмотров. */
  approved: number;
  views: number;
  /** Одобренные ролики без оценки. */
  toRate: number;
  submissionsCount: number;
  /** Никто ещё не сдал видео — заказ можно удалить. */
  deletable: boolean;
  createdAt: string;
}

export interface NewOrderInput extends VideoFormat {
  title: string;
  description: string;
  /** Ссылка на референс или материалы; null — без ссылки. */
  referenceUrl: string | null;
  /** Страница товара: креаторы ставят в описание ролика свою ссылку на неё, считаем переходы. */
  targetUrl: string | null;
  /** Весь бюджет, USDT, включая комиссию площадки. */
  budget: number;
  /** Порог просмотров для сдачи; null — по умолчанию (250). */
  minViews: number | null;
  category: OrderCategory;
  deadlineDays: number | null;
}

/** Площадка ролика — по ссылке на публикацию (src/common/platforms.ts). */
export type Platform = 'TIKTOK' | 'YOUTUBE' | 'VK' | 'INSTAGRAM' | 'X' | 'OTHER';

export const PLATFORM_NAMES: Record<Platform, string> = {
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  VK: 'VK',
  INSTAGRAM: 'Instagram',
  X: 'X',
  OTHER: 'Другое',
};

/** Площадки, которые рекламодатель может указать в заказе (enum VideoPlatform на бэкенде). */
export type VideoPlatform = Exclude<Platform, 'OTHER'>;
export const VIDEO_PLATFORMS: VideoPlatform[] = ['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'VK', 'X'];

/** Ответ `GET /api/my-orders/:id/report` — см. src/api/order-report.ts. Деньги в USDT, с комиссией. */
export interface OrderReport {
  order: { id: number; title: string; status: OrderStatus };
  summary: {
    budget: number;
    spent: number;
    /** Под ролики на проверке. */
    reserved: number;
    left: number;
    views: number;
    /** Сумма известных лайков: вне YouTube их вводит модератор по желанию. */
    likes: number;
    /** Переходы по ссылкам на товар; null — у заказа нет страницы товара. */
    clicks: number | null;
    videos: number;
    creators: number;
    /** Фактическая цена 1000 просмотров; null — просмотров ещё нет. */
    cpm: number | null;
  };
  platforms: { platform: Platform; videos: number; views: number }[];
  /** Воронка: открыли карточку → взяли → не успели / на проверке / отклонено / одобрено. */
  funnel: { viewers: number; taken: number; expired: number; onReview: number; rejected: number; approved: number };
  /** Советы, что поправить в заказе. */
  insights: { code: string; text: string }[];
  /** Одобренные ролики, больше просмотров — выше. */
  items: {
    id: number;
    videoUrl: string | null;
    platform: Platform;
    creator: string;
    creatorId: number;
    views: number;
    /** null — неизвестно. */
    likes: number | null;
    clicks: number | null;
    rating: number | null;
    approvedAt: string | null;
  }[];
}


/** Ответы `/api/mod/*` — см. src/api/moderation.controller.ts. */
export interface ModQueue {
  orders: {
    id: number;
    title: string;
    budget: number;
    advertiser: string;
    /** С какого момента ждёт проверки: после правки заказ встаёт в очередь заново. */
    queuedAt: string;
    /** После правки бюджет выше одобренного — проверить доплату. */
    budgetRaised: boolean;
    /** В тексте похоже на контакты для связи в обход площадки. */
    hasContacts: boolean;
  }[];
  videos: { id: number; orderTitle: string; creator: string; submittedAt: string | null }[];
  /** Холд закончился — проверить публикацию и зафиксировать итог. */
  holds: { id: number; orderTitle: string; creator: string; decidedAt: string | null }[];
  /** Отзывы рекламодателей с текстом — в профиле креатора только после проверки. */
  reviews: {
    submissionId: number;
    orderTitle: string;
    advertiser: string;
    creator: string;
    rating: number;
    review: string;
    queuedAt: string;
    hasContacts: boolean;
  }[];
}

export interface ModStats {
  orders: { pending: number; open: number; rejected: number; closed: number; total: number };
  submissions: { pending: number; approved: number; rejected: number };
}

export interface ModFunnel {
  orders: {
    created: number;
    published: number;
    rejected: number;
    withClaims: number;
    withVideos: number;
    withAccepted: number;
    /** Медиана от создания до решения модератора, часы; null — решений не было. */
    moderationHours: number | null;
  };
  videos: {
    submitted: number;
    pending: number;
    moderatorRejected: number;
    accepted: number;
  };
  users: { new: number; activeAdvertisers: number; activeCreators: number };
  /** Начислено креаторам за одобренные ролики и комиссия площадки сверх этого, USDT. */
  turnover: { amount: number; fee: number };
  /** Частые причины отклонения роликов — текстом, как написал модератор. */
  rejectReasons: { reason: string; count: number }[];
  /** Бизнес-метрики — см. AnalyticsService.business. Деньги — USDT. */
  business: {
    /** Бюджеты опубликованных заказов, с комиссией. */
    placed: number;
    avgBudget: number | null;
    /** Доля бюджета, освоенная завершёнными заказами, %; null — завершённых нет. */
    utilization: number | null;
    finished: number;
    /** Завершённые, освоившие меньше половины бюджета. */
    underused: number;
    /** Медиана от публикации до первого отклика, часы. */
    firstClaimHours: number | null;
    advertisers: { total: number; repeat: number };
    creators: { total: number; repeat: number };
    /** На сейчас, не за период: начислено креаторам и не выплачено; из этого — в заявках. */
    debt: { owed: number; requested: number };
  };
}

export interface ModOrderRow {
  id: number;
  title: string;
  budget: number;
  status: OrderStatus;
  advertiser: string;
  submissionsCount: number;
  createdAt: string;
}

export interface ModOrder extends VideoFormat {
  id: number;
  title: string;
  description: string;
  referenceUrl: string | null;
  targetUrl: string | null;
  budget: number;
  /** Бюджет, одобренный в прошлый раз; null — заказ ещё не одобряли. */
  approvedBudget: number | null;
  feePercent: number;
  /** Фонд выплат креаторам (бюджет без комиссии), USDT — от него считается ставка. */
  pool: number;
  minViews: number;
  /** Ставка за 1000 просмотров, USDT; null — ещё не назначена. */
  cpm: number | null;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  moderatorComment: string | null;
  advertiser: string;
  createdAt: string;
  /** Фрагменты, похожие на контакты (@ник, t.me, телефон…) — см. src/common/contacts.ts. */
  contacts: string[];
  /** Версия, которую видит модератор: решение по устаревшей версии бэкенд отклонит. */
  version: string;
}

export interface ModVideo {
  id: number;
  status: SubmissionStatus;
  videoUrl: string | null;
  submittedAt: string | null;
  creator: string;
  creatorId: number;
  attempt: number;
  /** На проверке — заявлено креатором, после одобрения — зафиксировано. */
  views: number | null;
  /** Сейчас по данным API площадки (YouTube); null — вводится вручную по ссылке. */
  autoViews: number | null;
  /** Зафиксированные лайки; null — не вводили. */
  likes: number | null;
  /** Лайки по данным API площадки; null — нет API или автор их скрыл. */
  autoLikes: number | null;
  /**
   * Чей ролик: verified — посчитан по аккаунту креатора (`viaAccount`) или автор есть в его соцсетях;
   * mismatch — автора нет в профиле; unknown — площадка автора не отдала, сверить вручную.
   */
  author: {
    status: 'verified' | 'mismatch' | 'unknown';
    viaAccount: boolean;
    /** Канал или аккаунт автора: «Название · @handle». */
    name: string | null;
    url: string | null;
  };
  platform: Platform;
  /** USDT: резерв или начислено. */
  payout: number;
  decidedAt: string | null;
  finalizedAt: string | null;
  /** Через сколько дней после одобрения фиксируется итог просмотров. */
  holdDays: number;
  order: {
    id: number;
    title: string;
    description: string;
    cpm: number | null;
    minViews: number;
    /** Свободный остаток фонда, USDT. */
    free: number;
    /** Ролик сдан до правки заказа — условия выше прежние, проверять по ним. */
    termsBeforeEdit: boolean;
  } & VideoFormat;
}

/** Ответ `GET /api/balance` — см. src/api/balance.controller.ts. Суммы в USDT. */
export interface Balance {
  earned: number;
  /** Начислено, но ждёт итога просмотров (холд) — вывести пока нельзя. */
  held: number;
  /** Когда ближайший ролик выйдет из холда; null — в холде ничего нет. */
  nextReleaseAt: string | null;
  paid: number;
  /** В открытой заявке на вывод. */
  requested: number;
  available: number;
  minPayout: number;
  /** Кошелёк USDT (TRC20) из профиля; null — не указан, вывести нельзя. */
  wallet: string | null;
  payouts: {
    id: number;
    amount: number;
    status: 'REQUESTED' | 'PAID' | 'REJECTED';
    /** Причина отказа. */
    comment: string | null;
    createdAt: string;
    decidedAt: string | null;
  }[];
}

export interface ModPayout {
  id: number;
  amount: number;
  /** Кошелёк USDT (TRC20) на момент заявки; null — у заявок до кошельков. */
  wallet: string | null;
  creator: string;
  creatorId: number;
  /** Креатор заблокирован — заявку подали до бана. */
  banned: { at: string; reason: string | null } | null;
  createdAt: string;
}


/** Профиль креатора — см. src/api/profiles.service.ts. */
export interface CreatorProfile {
  id: number;
  name: string;
  /** Средняя оценка 1–5; null — отзывов нет. */
  rating: number | null;
  reviewsCount: number;
  completed: number;
  /** Блокировка — приходит только модератору. */
  ban: { at: string; reason: string | null } | null;
  /** Ссылки на соцсети, по порядку; на одной площадке может быть несколько. Чужим — пусто. */
  links: string[];
  /** Кошелёк USDT (TRC20) для выплат — только в своём профиле и модератору. */
  wallet: string | null;
  /** Сообщения о новых заказах — только в своём профиле и модератору. */
  notifyNewOrders: boolean | null;
  reviews: {
    submissionId: number;
    rating: number;
    review: string | null;
    /** null — заказ другого рекламодателя: его название рекламодателю не показываем. */
    orderTitle: string | null;
    decidedAt: string | null;
  }[];
  portfolio: { submissionId: number; videoUrl: string | null; orderTitle: string | null }[];
}

/** Оценка рекламодателя одобренному ролику. */
export interface Feedback {
  rating: number;
  review: string;
  portfolioAllowed: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Ошибка API. `userMessage` — текст, который можно показать пользователю: только наши
 * 400/403/404/429 (их тексты пишет бэкенд сам). Остальное — общий текст, чтобы не светить внутренности.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
  ) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `tma ${getInitData()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let userMessage = i18next.t('common.genericError');
    if ([400, 403, 404, 429].includes(res.status)) {
      const data = (await res.json().catch(() => null)) as {
        message?: unknown;
        banned?: boolean;
        reason?: string | null;
        supportUrl?: string | null;
      } | null;
      if (typeof data?.message === 'string') userMessage = data.message;
      if (data?.banned)
        banned.value = { reason: data.reason ?? null, supportUrl: data.supportUrl ?? null };
    }
    throw new ApiError(res.status, userMessage);
  }
  return (await res.json()) as T;
}

/**
 * Страница каталога. `after` — последний показанный заказ (без него — первая страница).
 * hasMore — есть ли следующая; total — для заголовка, может отставать на полминуты.
 */
export function fetchOpenOrders(after?: OrderSummary, category?: OrderCategory, platform?: VideoPlatform) {
  const query = new URLSearchParams();
  if (after) {
    query.set('afterId', String(after.id));
    query.set('afterCreatedAt', after.createdAt);
  }
  if (category) query.set('category', category);
  if (platform) query.set('platform', platform);
  return request<{ items: OrderSummary[]; hasMore: boolean; total: number }>('GET', `/api/orders?${query}`);
}

export function fetchOrder(id: number) {
  return request<OrderDetail>('GET', `/api/orders/${id}`);
}

export function claimOrder(id: number) {
  return request<{ submissionId: number }>('POST', `/api/orders/${id}/claim`);
}

export function fetchMySubmissions() {
  return request<MySubmission[]>('GET', '/api/submissions');
}

export function submitVideo(submissionId: number, videoUrl: string, views: number) {
  return request<{ ok: true }>('POST', `/api/submissions/${submissionId}/video`, {
    videoUrl,
    views,
  });
}

export function fetchMyOrders() {
  return request<MyOrder[]>('GET', '/api/my-orders');
}

export function createOrder(input: NewOrderInput) {
  return request<{ id: number }>('POST', '/api/my-orders', input);
}

/** Правка заказа. `deadlineDays` не передан — срок не меняется, null — без срока. */
export function updateOrder(
  id: number,
  input: Omit<NewOrderInput, 'deadlineDays'> & { deadlineDays?: number | null },
) {
  return request<{ ok: true }>('PUT', `/api/my-orders/${id}`, input);
}

export function closeOrder(id: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${id}/close`);
}

/** Продлить срок на `days` дней; истёкший заказ снова откроется. */
export function extendOrder(id: number, days: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${id}/extend`, { days });
}

export function deleteOrder(id: number) {
  return request<{ ok: true }>('DELETE', `/api/my-orders/${id}`);
}

export function fetchOrderReport(orderId: number) {
  return request<OrderReport>('GET', `/api/my-orders/${orderId}/report`);
}

/** Отчёт файлом CSV — придёт в чат с ботом. */
export function sendReportCsv(orderId: number) {
  return request<{ ok: true }>('POST', `/api/my-orders/${orderId}/report/csv`);
}

/** `onModeration` — отзыв с текстом ушёл на проверку и появится в профиле креатора после неё. */
export function rateVideo(submissionId: number, feedback: Feedback) {
  return request<{ ok: true; onModeration: boolean }>(
    'POST',
    `/api/submissions/${submissionId}/rate`,
    feedback,
  );
}

export function fetchMyProfile() {
  return request<CreatorProfile>('GET', '/api/profile');
}

export function fetchCreator(id: number) {
  return request<CreatorProfile>('GET', `/api/creators/${id}`);
}

const photos = new Map<number, Promise<string | null>>();

/**
 * Фото креатора из Telegram как blob-ссылка для <img>; null — фото нет или оно недоступно.
 * Через fetch, а не <img src>: картинке тоже нужен заголовок авторизации. Один запрос на запуск.
 */
export function fetchCreatorPhoto(id: number): Promise<string | null> {
  let photo = photos.get(id);
  if (!photo) {
    photo = fetch(`/api/creators/${id}/photo`, {
      headers: { Authorization: `tma ${getInitData()}` },
    })
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    photos.set(id, photo);
  }
  return photo;
}

export function updateProfileLinks(links: string[]) {
  return request<{ ok: true }>('PUT', '/api/profile/links', { links });
}

export function updateNotifications(newOrders: boolean) {
  return request<{ ok: true }>('PUT', '/api/profile/notifications', { newOrders });
}

/** Пустая строка — убрать кошелёк. */
export function updateWallet(wallet: string) {
  return request<{ ok: true }>('PUT', '/api/profile/wallet', { wallet });
}

/** Площадка, где креатор подключает свои аккаунты — тогда просмотры его роликов оттуда считаются сами. */
export interface SocialAccount {
  platform: 'TIKTOK' | 'VK' | 'INSTAGRAM';
  name: string;
  /** Подключённые аккаунты; label — имя на площадке, null — площадка его не отдала. */
  accounts: { id: number; label: string | null }[];
  /** Можно подключить ещё один (у площадки есть лимит). */
  canAdd: boolean;
}

/** Пусто — ни одна площадка пока не подключается (нет ключей), раздел в профиле не показываем. */
export function fetchSocialAccounts() {
  return request<SocialAccount[]>('GET', '/api/accounts');
}

/** Ссылка на вход на площадке — открыть во внешнем браузере. */
export function connectSocialAccount(platform: SocialAccount['platform']) {
  return request<{ url: string }>('POST', `/api/accounts/${platform.toLowerCase()}/connect`);
}

export function disconnectSocialAccount(accountId: number) {
  return request<{ ok: true }>('DELETE', `/api/accounts/${accountId}`);
}

/** Модератор: опубликовать отзыв с проверки в профиле креатора. */
export function approveReview(submissionId: number) {
  return request<{ ok: true }>('POST', `/api/mod/reviews/${submissionId}/approve`);
}

/** Модератор: удалить отзыв (оценку и текст) — опубликованный или с проверки. */
export function removeReview(submissionId: number) {
  return request<{ ok: true }>('DELETE', `/api/mod/reviews/${submissionId}`);
}

type Me = {
  isModerator: boolean;
  supportUrl: string | null;
  /** Язык интерфейса: выбранный в профиле или по Telegram; languageChosen — выбран ли вручную. */
  language: Lang;
  languageChosen: boolean;
  /** Кабинет, открытый последним (role.ts); null — ещё не выбирал. */
  cabinet: 'creator' | 'advertiser' | null;
  /** Комиссия площадки для новых заказов, %: бюджет креаторам — без неё. */
  feePercent: number;
};
let me: Promise<Me> | undefined;

/** Один запрос на запуск: initData, а с ним и ответ, до перезапуска Mini App не меняется. */
/** Язык интерфейса и бота; null — снова по языку Telegram. */
/** Запомнить кабинет на сервере — тот же откроется на другом устройстве. */
export function updateCabinet(cabinet: 'creator' | 'advertiser') {
  me = undefined; // /api/me вернёт уже новый кабинет
  return request<{ ok: true }>('PUT', '/api/profile/cabinet', { cabinet });
}

export function updateLanguage(language: Lang | null) {
  me = undefined; // /api/me вернёт уже новый язык
  return request<{ ok: true }>('PUT', '/api/profile/language', { language });
}

export function fetchMe() {
  // неудачный запрос не запоминаем — иначе сбой сети считался бы ответом до перезапуска
  return (me ??= request<Me>('GET', '/api/me').catch((err) => {
    me = undefined;
    throw err;
  }));
}

export function fetchModQueue() {
  return request<ModQueue>('GET', '/api/mod/queue');
}

export function fetchModStats() {
  return request<ModStats>('GET', '/api/mod/stats');
}

/** Воронка за последние `days` дней; без аргумента — за всё время. См. src/api/analytics.service.ts. */
export function fetchModFunnel(days?: number) {
  return request<ModFunnel>('GET', `/api/mod/funnel${days ? `?days=${days}` : ''}`);
}

export function fetchAllOrders(page: number) {
  return request<Page<ModOrderRow>>('GET', `/api/mod/orders?page=${page}`);
}

export function fetchModOrder(id: number) {
  return request<ModOrder>('GET', `/api/mod/orders/${id}`);
}

/**
 * `version` — из fetchModOrder: если рекламодатель успел изменить заказ, решение не пройдёт.
 * `cpm` — ставка за 1000 просмотров, USDT (только при одобрении).
 * `budgetConfirmed` — новый бюджет, USDT: модератор отметил, что доплата за повышение получена.
 */
export function moderateOrder(
  id: number,
  decision: 'approve' | 'reject',
  version: string,
  extra: { comment?: string; cpm?: number; budgetConfirmed?: number } = {},
) {
  return request<{ ok: true }>('POST', `/api/mod/orders/${id}/${decision}`, { version, ...extra });
}

export function fetchModVideo(id: number) {
  return request<ModVideo>('GET', `/api/mod/videos/${id}`);
}

/** Одобрить с просмотрами (`views`) или отклонить с причиной (`comment`). */
export function moderateVideo(
  id: number,
  decision: 'approve' | 'reject',
  body: { views?: number; likes?: number | null; comment?: string },
) {
  return request<{ ok: true }>('POST', `/api/mod/videos/${id}/${decision}`, body);
}

let rate: Promise<number | null> | undefined;

/** Курс USDT в рублях, один запрос на запуск; null — неизвестен (подсказку «≈ … ₽» не показываем). */
export function fetchRate() {
  return (rate ??= request<{ rub: number | null }>('GET', '/api/rate').then(
    (r) => r.rub,
    () => {
      rate = undefined;
      return null;
    },
  ));
}

export function fetchBalance() {
  return request<Balance>('GET', '/api/balance');
}

export function requestPayout(amount: number) {
  return request<{ ok: true }>('POST', '/api/balance/withdraw', { amount });
}

export function fetchModPayouts() {
  return request<ModPayout[]>('GET', '/api/mod/payouts');
}

/** Отметить заявку выплаченной или отклонить с причиной — сумма вернётся на баланс. */
export function decidePayout(id: number, decision: 'paid' | 'reject', comment?: string) {
  return request<{ ok: true }>('POST', `/api/mod/payouts/${id}/${decision}`, comment === undefined ? undefined : { comment });
}

/** Итог холда: публикация на месте, просмотры — для отчёта. */
export function finalizeVideo(id: number, views: number, likes: number | null) {
  return request<{ ok: true }>('POST', `/api/mod/videos/${id}/finalize`, { views, likes });
}

/** При итоге публикации нет — начисление из холда отменяется. */
export function markPublicationDeleted(id: number) {
  return request<{ ok: true }>('POST', `/api/mod/videos/${id}/deleted`);
}

/** На что жалоба: VIDEO и REVIEW — по id отклика, PROFILE — по id пользователя. */
export type ReportTarget = 'ORDER' | 'VIDEO' | 'REVIEW' | 'PROFILE';

/** Причины жалоб по типу объекта; коды проверяет бэкенд (src/reports), названия — в словаре (reportReasons). */
export const REPORT_REASONS: Record<ReportTarget, string[]> = {
  ORDER: ['FRAUD', 'PROHIBITED', 'FAKE_REVIEWS', 'PERSONAL_DATA', 'SPAM', 'OFF_PLATFORM', 'OTHER'],
  VIDEO: ['STOLEN', 'UNAVAILABLE', 'BRAND_NEGATIVE', 'BLACKMAIL', 'OFF_PLATFORM', 'OTHER'],
  REVIEW: ['INSULT', 'FALSE', 'PERSONAL_DATA', 'OFF_PLATFORM', 'OTHER'],
  PROFILE: ['IMPERSONATION', 'OFFENSIVE', 'OFF_PLATFORM', 'OTHER'],
};

export function reasonLabel(target: ReportTarget, code: string): string {
  return REPORT_REASONS[target].includes(code) ? i18next.t(`reportReasons.${target}.${code}`) : code;
}

/** Сообщение менеджеру из мини-аппа; ответ придёт в чат с ботом. */
export function sendSupportMessage(text: string) {
  return request<{ ok: true }>('POST', '/api/support', { text });
}

export function createReport(report: {
  target: ReportTarget;
  targetId: number;
  reason: string;
  comment: string;
}) {
  return request<{ ok: true }>('POST', '/api/reports', report);
}

/** Открытые жалобы на один объект — см. ReportsService.listOpen. */
export interface ModReportGroup {
  target: ReportTarget;
  targetId: number;
  /** null — объект уже удалён. */
  subject: {
    title: string;
    text: string | null;
    /** Кто отвечает за объект: автор заказа, видео, отзыва или владелец профиля. */
    author: string;
    authorId: number;
    /** Какой профиль креатора открыть (для заказа — нет). */
    profileId: number | null;
    orderId: number | null;
  } | null;
  reports: { id: number; reason: string; comment: string | null; reporter: string; createdAt: string }[];
}

export function fetchModReports() {
  return request<ModReportGroup[]>('GET', '/api/mod/reports');
}

/**
 * actioned — применить меру (закрыть заказ, убрать видео из портфолио, удалить отзыв, стереть ссылки).
 * banReason — ещё и заблокировать автора объекта.
 */
export function resolveReports(
  target: ReportTarget,
  targetId: number,
  actioned: boolean,
  banReason?: string,
) {
  return request<{ ok: true }>('POST', '/api/mod/reports/resolve', {
    target,
    targetId,
    actioned,
    banReason,
  });
}

export function banUser(userId: number, reason: string) {
  return request<{ ok: true }>('POST', `/api/mod/users/${userId}/ban`, { reason });
}

export function unbanUser(userId: number) {
  return request<{ ok: true }>('POST', `/api/mod/users/${userId}/unban`);
}
