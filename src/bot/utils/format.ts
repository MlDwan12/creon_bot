import type {
  Order,
  OrderCategory,
  OrderStatus,
  Submission,
  SubmissionStatus,
  User,
} from '@prisma/client';

/** Cards below render as parse_mode HTML — escape any user-controlled text before interpolating it. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Merge HTML parse mode into a reply/edit extra options object (inline keyboard, etc). */
export function html<T extends object>(extra?: T): T & { parse_mode: 'HTML' } {
  return { ...(extra ?? ({} as T)), parse_mode: 'HTML' };
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_MODERATION: '🕓 на проверке модератора',
  OPEN: '✅ открыт',
  REJECTED: '❌ отклонён модератором',
  CLOSED: '🔒 закрыт',
};

export const ORDER_CATEGORIES: { code: OrderCategory; label: string }[] = [
  { code: 'PRODUCT_REVIEW', label: '📦 Обзор товара' },
  { code: 'BEAUTY', label: '💄 Красота' },
  { code: 'FOOD', label: '🍔 Еда' },
  { code: 'FASHION', label: '👗 Мода' },
  { code: 'GAMING', label: '🎮 Игры' },
  { code: 'FITNESS', label: '🏋️ Спорт и фитнес' },
  { code: 'ENTERTAINMENT', label: '🎵 Развлечения' },
  { code: 'TECH', label: '💻 Техника' },
  { code: 'OTHER', label: '🗂 Другое' },
];

const ORDER_CATEGORY_LABELS: Record<OrderCategory, string> = Object.fromEntries(
  ORDER_CATEGORIES.map((c) => [c.code, c.label]),
) as Record<OrderCategory, string>;

export function orderCategoryLabel(category: OrderCategory): string {
  return ORDER_CATEGORY_LABELS[category];
}

export function formatDeadline(deadline: Date): string {
  return deadline.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

type OrderWithRelations = Order & { advertiser?: User };

export function formatOrderCard(
  order: OrderWithRelations,
  submissions?: Submission[],
  withAdvertiser = false,
): string {
  const lines = [
    `📦 <b>Заказ #${order.id}</b> — ${ORDER_STATUS_LABELS[order.status]}`,
    `<b>${escapeHtml(order.title)}</b>`,
    escapeHtml(order.description),
    `${ORDER_CATEGORY_LABELS[order.category]}`,
  ];
  if (order.price) lines.push(`💰 ${escapeHtml(order.price)}`);
  if (order.deadline)
    lines.push(`⏰ Дедлайн: ${formatDeadline(order.deadline)}`);
  if (withAdvertiser && order.advertiser)
    lines.push(`Рекламодатель: ${escapeHtml(creatorLabel(order.advertiser))}`);
  if (submissions) lines.push(`Откликов: ${submissions.length}`);
  if (order.moderatorComment)
    lines.push(`Комментарий модератора: ${escapeHtml(order.moderatorComment)}`);
  return lines.join('\n');
}

const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  IN_PROGRESS: '🎬 В работе',
  SUBMITTED: '⏳ На модерации',
  MODERATOR_APPROVED: '⏳ Ждёт подтверждения рекламодателя',
  MODERATOR_REJECTED: '❌ Отклонено модератором',
  ADVERTISER_APPROVED: '✅ Подтверждено',
  ADVERTISER_REJECTED: '❌ Отклонено рекламодателем',
};

type SubmissionWithRelations = Submission & { order: Order; creator?: User };

export function formatSubmissionCard(
  submission: SubmissionWithRelations,
  withCreator = false,
): string {
  const lines = [
    `Заказ: <b>${escapeHtml(submission.order.title)}</b>`,
    `Статус: <b>${SUBMISSION_STATUS_LABELS[submission.status]}</b>`,
    submission.videoUrl
      ? `Видео: ${escapeHtml(submission.videoUrl)}`
      : 'Видео: ещё не прислано',
  ];
  if (withCreator && submission.creator) {
    lines.unshift(`Креатор: ${escapeHtml(creatorLabel(submission.creator))}`);
  }
  if (submission.moderatorComment)
    lines.push(
      `Комментарий модератора: ${escapeHtml(submission.moderatorComment)}`,
    );
  if (submission.advertiserComment)
    lines.push(
      `Комментарий рекламодателя: ${escapeHtml(submission.advertiserComment)}`,
    );
  return lines.join('\n');
}

export function creatorLabel(user: User): string {
  return user.username
    ? `@${user.username}`
    : (user.firstName ?? `id${user.telegramId}`);
}

export function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const SUBMISSION_LIST_ICONS: Record<SubmissionStatus, string> = {
  IN_PROGRESS: '🎬',
  SUBMITTED: '⏳',
  MODERATOR_APPROVED: '⏳',
  MODERATOR_REJECTED: '❌',
  ADVERTISER_APPROVED: '✅',
  ADVERTISER_REJECTED: '❌',
};

const SUBMISSION_LIST_WORDS: Record<SubmissionStatus, string> = {
  IN_PROGRESS: 'в работе',
  SUBMITTED: 'на модерации',
  MODERATOR_APPROVED: 'ждёт заказчика',
  MODERATOR_REJECTED: 'отклонено модератором',
  ADVERTISER_APPROVED: 'подтверждено',
  ADVERTISER_REJECTED: 'отклонено заказчиком',
};

/** Label for one attempt within a single order's submissions list — order is already known from context, so show status + time instead. */
export function submissionAttemptLabel(submission: Submission): string {
  const icon = SUBMISSION_LIST_ICONS[submission.status];
  const word = SUBMISSION_LIST_WORDS[submission.status];
  const time = submission.createdAt.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${icon} ${word} (${time})`;
}

/** Label for one submission in the advertiser's "responses for this order" picker list. */
export function submissionForAdvertiserLabel(
  submission: Submission & { creator: User },
): string {
  const icon = SUBMISSION_LIST_ICONS[submission.status];
  const word = SUBMISSION_LIST_WORDS[submission.status];
  return `${icon} ${truncate(creatorLabel(submission.creator), 20)} — ${word}`;
}

/** Label for an order button in the grouped "my submissions" list — one button per order, with the attempt count. */
export function orderGroupLabel(order: Order, attemptCount: number): string {
  return `📦 #${order.id} ${truncate(order.title, 22)} (${attemptCount})`;
}
