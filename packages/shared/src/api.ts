/**
 * Ответы API бэкенда и общие константы — для мини-аппа (webapp/) и сайта (web/).
 * Только типы и код без зависимостей: пакет подключается алиасом @fixum/shared без установки,
 * поэтому импортировать сюда библиотеки нельзя (i18next, react — у каждого приложения свои).
 */

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
  /** Ссылка на бриф или материалы к заданию; null — нет. */
  referenceUrl: string | null;
  /** Свою ссылку на товар креатор держит ещё и в шапке профиля — до итога холда. */
  linkInBio: boolean;
  /** Выплата креатору за 1000 просмотров, USDT. */
  cpm: number | null;
  /** Ролик можно сдать, когда он наберёт столько просмотров. */
  minViews: number;
  /** Сколько ещё осталось на выплаты креаторам, USDT — округлено вниз до 100 (точное не показываем). */
  free: number;
  /** Осталось меньше этой суммы (free тогда 0); null — free как есть. */
  freeUnder: number | null;
  /** Осталось меньше 30% фонда — подсвечиваем «успейте». */
  budgetLow: boolean;
  /** Весь фонд зарезервирован под ролики на проверке: взять нельзя, пока место не освободится. */
  fundBusy: boolean;
  category: OrderCategory;
  deadline: string | null;
  createdAt: string;
}

/** Ответ `GET /api/orders/:id`. */
export interface OrderDetail extends OrderSummary {
  /** Примеры роликов, какие хочет заказчик; url — редирект Fixum, без ника автора в ссылке. */
  examples: { platform: Platform; url: string }[];
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
export type OrderStatus =
  | 'PENDING_MODERATION'
  | 'OPEN'
  | 'REJECTED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'EDIT_REJECTED';

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
  /** «В работе», а фонд заказа занят роликами на проверке: сдать нельзя, время на паузе. */
  fundPaused: boolean;
  /** На проверке — заявлено креатором, после одобрения — зафиксировано модератором. */
  views: number | null;
  /** USDT: на проверке — зарезервировано, после одобрения — начислено. */
  payout: number;
  /** Сдан с согласием на остаток фонда, USDT: просмотры сверх него не оплачиваются; null — влез в фонд. */
  agreedPayout: number | null;
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
    /** При сдаче — подтвердить, что ссылка стоит в шапке профиля. */
    linkInBio: boolean;
  };
}

/** Ответ `GET /api/my-orders` — см. src/api/my-orders.controller.ts. */
export interface MyOrder extends VideoFormat {
  id: number;
  title: string;
  description: string;
  exampleUrls: string[];
  referenceUrl: string | null;
  targetUrl: string | null;
  linkInBio: boolean;
  /** Весь бюджет, USDT. */
  budget: number;
  minViews: number;
  category: OrderCategory;
  deadline: string | null;
  status: OrderStatus;
  rejectReason: string | null;
  /** Опубликованный заказ изменён, правку ещё не одобрили: ролики не сдают, можно исправить или закрыть. */
  frozen: boolean;
  /** Весь фонд зарезервирован под ролики на проверке — новые не принимаются, пока их не проверят. */
  fundBusy: boolean;
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
  /** Примеры роликов: от 3 до 10 ссылок на ролики площадок. */
  exampleUrls: string[];
  /** Ссылка на бриф или материалы; null — без ссылки. */
  referenceUrl: string | null;
  /** Страница товара: креаторы ставят в описание ролика свою ссылку на неё, считаем переходы. */
  targetUrl: string | null;
  /** Креатор ставит свою ссылку ещё и в шапку профиля; только с targetUrl. */
  linkInBio: boolean;
  /** Весь бюджет, USDT, включая комиссию площадки. */
  budget: number;
  /** Порог просмотров для сдачи; null — по умолчанию (250). */
  minViews: number | null;
  category: OrderCategory;
  deadlineDays: number | null;
}

/** Площадка ролика — по ссылке на публикацию (src/common/platforms.ts). */
export type Platform =
  'TIKTOK' | 'YOUTUBE' | 'VK' | 'INSTAGRAM' | 'X' | 'OTHER';

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

export const VIDEO_PLATFORMS: VideoPlatform[] = [
  'TIKTOK',
  'INSTAGRAM',
  'YOUTUBE',
  'VK',
  'X',
];

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
  funnel: {
    viewers: number;
    taken: number;
    expired: number;
    onReview: number;
    rejected: number;
    approved: number;
  };
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
    /** Можно оценить: ещё не оценён и модератор не снимал оценку. */
    rateable: boolean;
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
  videos: {
    id: number;
    orderTitle: string;
    creator: string;
    submittedAt: string | null;
    /** Фонд заказа занят — по нему никто не сдаёт, пока не проверят; такие — первыми. */
    holdsFund: boolean;
  }[];
  /** Холд закончился — проверить публикацию и зафиксировать итог. */
  holds: {
    id: number;
    orderTitle: string;
    creator: string;
    decidedAt: string | null;
  }[];
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
  orders: {
    pending: number;
    open: number;
    rejected: number;
    closed: number;
    total: number;
  };
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

/** Метрики заказов с одним значением признака — см. AnalyticsService.whatWorks. */
export interface WhatWorksRow {
  /** Значение признака: код категории, площадки, ориентации; длительность — '15'|'30'|'60'|'LONG';
   *  ставка — USDT за 1000 просмотров строкой; 'ANY' — требование не задано. */
  key: string;
  orders: number;
  /** Взяли в работу из открывших карточку, %. */
  takeRate: number | null;
  /** Средние просмотры одобренного ролика. */
  avgViews: number | null;
  /** Одобрено из решённых роликов, %. */
  approveRate: number | null;
}

export type WhatWorksSlice =
  'category' | 'platform' | 'orientation' | 'duration' | 'cpm';

export interface WhatWorks {
  /** Меньше заказов в строке — «мало данных». */
  minOrders: number;
  slices: Record<WhatWorksSlice, WhatWorksRow[]>;
  /** Пользователи за период по последнему кабинету и тому, что делали. */
  audience: {
    cabinet: 'CREATOR' | 'ADVERTISER' | null;
    activity: 'both' | 'orders' | 'videos' | 'none';
    count: number;
  }[];
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
  /** Примеры роликов — модератору сами ссылки. */
  exampleUrls: string[];
  referenceUrl: string | null;
  targetUrl: string | null;
  linkInBio: boolean;
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
   * Чей ролик: verified — посчитан по подключённому аккаунту креатора; inProfile — автор есть в
   * соцсетях профиля, но владение не подтверждено; mismatch — автора нет в профиле;
   * unknown — площадка автора не отдала, сверить вручную.
   */
  author: {
    status: 'verified' | 'inProfile' | 'mismatch' | 'unknown';
    viaAccount: boolean;
    /** Аккаунт подключили столько дней назад (меньше 7) — повод проверить; null — давно или не по аккаунту. */
    connectedDaysAgo: number | null;
    /** Канал или аккаунт автора: «Название · @handle». */
    name: string | null;
    url: string | null;
  };
  platform: Platform;
  /** USDT: резерв или начислено. */
  payout: number;
  /** Креатор согласился при сдаче на остаток фонда, USDT; null — ролик влез в фонд. */
  agreedPayout: number | null;
  /** Сколько роликов креатора уже отклонено за завышенные просмотры. */
  inflatedBefore: number;
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
    exampleUrls: string[];
    /** Ссылка креатора должна стоять в шапке профиля; bioLink — какая именно (null — у ролика нет кода). */
    linkInBio: boolean;
    bioLink: string | null;
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
  /** Кошелёк сменили за столько часов до заявки (меньше 48); null — не меняли. */
  walletChangedHoursBefore: number | null;
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
  /** final — без права обжалования. */
  ban: { at: string; reason: string | null; final: boolean } | null;
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
  portfolio: {
    submissionId: number;
    videoUrl: string | null;
    orderTitle: string | null;
  }[];
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
    /** Тело ответа с ошибкой — для ответов с данными (409 OVER_BUDGET). */
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(`HTTP ${status}`);
  }
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

/** Строка вкладки «Люди» — см. src/moderation/mod-users.service.ts. */
export interface ModUserRow {
  id: number;
  label: string;
  telegramId: string;
  createdAt: string;
  banned: { at: string; reason: string | null; final: boolean } | null;
  /** Брал заказы: одобрено роликов и доступно к выводу, USDT. */
  creator: { approved: number; available: number } | null;
  /** Размещал заказы: всего и открыто. */
  advertiser: { orders: number; open: number } | null;
}

export type ModUsersFilter = 'all' | 'creators' | 'advertisers' | 'banned';

/** История модерации пользователя: жалобы на него, решения по ним, блокировки. */
export interface ModUserHistory {
  ban: { at: string; reason: string | null; by: string | null } | null;
  events: (
    | {
        kind: 'report';
        at: string;
        target: ReportTarget;
        targetId: number;
        reason: string;
        comment: string | null;
        reporter: string;
        reporterId: number;
        status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
      }
    | {
        kind: 'action';
        at: string;
        type: ModeratorActionType;
        target: ReportTarget | null;
        targetId: number;
        comment: string | null;
        moderator: string;
      }
  )[];
}

/** Действие модератора — журнал ModeratorAction (src/moderation/moderator-actions.service.ts). */
export type ModeratorActionType =
  | 'ORDER_APPROVE'
  | 'ORDER_REJECT'
  | 'VIDEO_APPROVE'
  | 'VIDEO_REJECT'
  | 'HOLD_FINALIZE'
  | 'PUBLICATION_DELETED'
  | 'REVIEW_APPROVE'
  | 'REVIEW_REMOVE'
  | 'REPORT_ACTION'
  | 'REPORT_DISMISS'
  | 'PAYOUT_PAID'
  | 'PAYOUT_REJECT'
  | 'USER_BAN'
  | 'USER_UNBAN';

export interface ModeratorStats {
  moderatorId: string;
  label: string;
  counts: Record<ModeratorActionType, number>;
  /** Проведено выплат, USDT. */
  paid: number;
  /** Медиана ожидания до решения, секунды; null — решений этого вида не было. */
  medianWaitSec: Record<
    'orders' | 'videos' | 'holds' | 'reports' | 'payouts',
    number | null
  >;
}

/** Кабинет модератора: команда за период (с ним самим) и его последние действия. */
export interface ModMe {
  moderatorId: string;
  team: ModeratorStats[];
  recent: {
    id: number;
    type: ModeratorActionType;
    objectId: number;
    reportTarget: ReportTarget | null;
    amount: number | null;
    createdAt: string;
  }[];
}

/** На что жалоба: VIDEO и REVIEW — по id отклика, PROFILE — по id пользователя. */
export type ReportTarget = 'ORDER' | 'VIDEO' | 'REVIEW' | 'PROFILE';

/** Причины жалоб по типу объекта; коды проверяет бэкенд (src/reports), названия — в словаре (reportReasons). */
export const REPORT_REASONS: Record<ReportTarget, string[]> = {
  ORDER: [
    'FRAUD',
    'PROHIBITED',
    'FAKE_REVIEWS',
    'PERSONAL_DATA',
    'SPAM',
    'OFF_PLATFORM',
    'OTHER',
  ],
  VIDEO: [
    'STOLEN',
    'UNAVAILABLE',
    'BRAND_NEGATIVE',
    'BLACKMAIL',
    'OFF_PLATFORM',
    'OTHER',
  ],
  REVIEW: ['INSULT', 'FALSE', 'PERSONAL_DATA', 'OFF_PLATFORM', 'OTHER'],
  PROFILE: ['IMPERSONATION', 'OFFENSIVE', 'OFF_PLATFORM', 'OTHER'],
};

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
  reports: {
    id: number;
    reason: string;
    comment: string | null;
    reporter: string;
    createdAt: string;
  }[];
}

/** GET /api/me — кто вошёл (мини-апп и сайт). */
export interface Me {
  isModerator: boolean;
  supportUrl: string | null;
  /** Язык интерфейса: выбранный в профиле или по Telegram; languageChosen — выбран ли вручную. */
  language: 'ru' | 'en';
  languageChosen: boolean;
  /** Кабинет, открытый последним; null — ещё не выбирал. */
  cabinet: 'creator' | 'advertiser' | null;
  /** Имя из Telegram; null — не указано. */
  firstName: string | null;
}
