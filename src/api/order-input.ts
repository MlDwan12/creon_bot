import { BadRequestException } from '@nestjs/common';
import { OrderCategory, VideoOrientation } from '@prisma/client';
import {
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
  MAX_DEADLINE_DAYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_DURATION_SEC,
  MAX_BUDGET,
  MAX_CPM,
  MIN_BUDGET,
  MAX_VIEWS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  VIDEO_URL_RE,
} from '../common/validation';
import { findExactContacts } from '../common/contacts';
import { rublesToKopecks } from '../common/money';
import { DEFAULT_MIN_VIEWS } from '../orders/budget';
import { deadlineIn } from '../orders/deadline';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Тело `POST /api/my-orders` → данные для OrdersService.create. Нарушение — 400 с текстом,
 * который Mini App показывает пользователю.
 */
export function parseOrderInput(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;

  const title = text(b.title);
  if (!isMeaningfulText(title))
    throw new BadRequestException('Укажите название заказа');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(
      `Название длиннее ${MAX_TITLE_LENGTH} символов`,
    );
  }

  const description = text(b.description);
  if (!isMeaningfulText(description))
    throw new BadRequestException('Опишите, что нужно снять');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      `Описание длиннее ${MAX_DESCRIPTION_LENGTH} символов`,
    );
  }

  // Пусто — без ссылки. Ссылка на мессенджер или соцсеть — это контакт в обход площадки.
  const referenceUrl = text(b.referenceUrl) || undefined;
  if (referenceUrl !== undefined) {
    if (
      !VIDEO_URL_RE.test(referenceUrl) ||
      referenceUrl.length > MAX_URL_LENGTH
    )
      throw new BadRequestException(
        'Ссылка на референс должна начинаться с http:// или https://',
      );
    if (findExactContacts(referenceUrl).length)
      throw new BadRequestException(
        'Ссылка на мессенджер или соцсеть — это контакт: общение идёт через бота. Дайте ссылку на файл или видео',
      );
  }

  // Бюджет — всё, что платит рекламодатель, целыми рублями; в базу — копейками.
  const budget = b.budget;
  if (
    !Number.isInteger(budget) ||
    (budget as number) < MIN_BUDGET ||
    (budget as number) > MAX_BUDGET
  )
    throw new BadRequestException(
      `Бюджет — целое число рублей от ${MIN_BUDGET.toLocaleString('ru-RU')} до ${MAX_BUDGET.toLocaleString('ru-RU')}`,
    );

  // Пусто — порог по умолчанию.
  const minViews =
    b.minViews === undefined || b.minViews === null || b.minViews === ''
      ? DEFAULT_MIN_VIEWS
      : parseViews(b.minViews, 'Порог просмотров');

  const minDurationSec = durationSec(b.minDurationSec);
  const maxDurationSec = durationSec(b.maxDurationSec);
  if (minDurationSec && maxDurationSec && minDurationSec > maxDurationSec)
    throw new BadRequestException(
      'Минимальная длительность больше максимальной',
    );

  // Пусто — любая ориентация.
  const orientation = (b.orientation ?? null) as VideoOrientation | null;
  if (
    orientation !== null &&
    !Object.values(VideoOrientation).includes(orientation)
  )
    throw new BadRequestException('Неизвестная ориентация ролика');

  const category = b.category as OrderCategory;
  if (!Object.values(OrderCategory).includes(category)) {
    throw new BadRequestException('Выберите категорию');
  }

  const deadline =
    b.deadlineDays === undefined || b.deadlineDays === null
      ? undefined
      : deadlineIn(parseDeadlineDays(b.deadlineDays));

  return {
    title,
    description,
    referenceUrl,
    budgetMinor: rublesToKopecks(budget as number),
    minViews,
    minDurationSec,
    maxDurationSec,
    orientation,
    category,
    deadline,
  };
}

/** Требования к ролику из заказа — для ответов API, где поля перечислены явно. */
export function videoFormat(o: {
  minDurationSec: number | null;
  maxDurationSec: number | null;
  orientation: VideoOrientation | null;
}) {
  return {
    minDurationSec: o.minDurationSec,
    maxDurationSec: o.maxDurationSec,
    orientation: o.orientation,
  };
}

/** Ставка креатору за 1000 просмотров (решает модератор): рубли, до копеек; в базу — копейками. */
export function parseCpm(body: unknown): number {
  const cpm = (body as { cpm?: unknown } | null)?.cpm;
  const kopecks =
    typeof cpm === 'number' && Number.isFinite(cpm) ? rublesToKopecks(cpm) : 0;
  if (kopecks < 1 || kopecks > MAX_CPM * 100)
    throw new BadRequestException(
      `Ставка за 1000 просмотров — от 0,01 до ${MAX_CPM.toLocaleString('ru-RU')} ₽`,
    );
  return kopecks;
}

/** Число просмотров: целое от 1 до MAX_VIEWS. `what` — для текста ошибки. */
export function parseViews(value: unknown, what = 'Просмотры'): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_VIEWS
  )
    throw new BadRequestException(
      `${what} — целое число от 1 до ${MAX_VIEWS.toLocaleString('ru-RU')}`,
    );
  return value as number;
}

/** Лайки — по желанию: пусто — неизвестно (null), иначе целое от 0 до MAX_VIEWS. */
export function parseLikes(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_VIEWS
  )
    throw new BadRequestException(
      `Лайки — целое число от 0 до ${MAX_VIEWS.toLocaleString('ru-RU')}`,
    );
  return value as number;
}

/** Длительность в секундах из требований; пусто — любая (null). */
function durationSec(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_DURATION_SEC
  )
    throw new BadRequestException(
      `Длительность — целое число секунд от 1 до ${MAX_DURATION_SEC}`,
    );
  return value as number;
}

/**
 * Тело `PUT /api/my-orders/:id` — как при создании, кроме срока: `deadlineDays` не передан —
 * срок не меняется, null — без срока.
 */
export function parseOrderEdit(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const input = parseOrderInput({ ...b, deadlineDays: undefined });
  return {
    title: input.title,
    description: input.description,
    referenceUrl: input.referenceUrl ?? null,
    budgetMinor: input.budgetMinor,
    minViews: input.minViews,
    minDurationSec: input.minDurationSec,
    maxDurationSec: input.maxDurationSec,
    orientation: input.orientation,
    category: input.category,
    deadline:
      b.deadlineDays === undefined
        ? undefined
        : b.deadlineDays === null
          ? null
          : deadlineIn(parseDeadlineDays(b.deadlineDays)),
  };
}

/** Срок в днях — при создании заказа и при продлении. */
export function parseDeadlineDays(days: unknown): number {
  if (
    !Number.isInteger(days) ||
    (days as number) < 1 ||
    (days as number) > MAX_DEADLINE_DAYS
  ) {
    throw new BadRequestException(
      `Срок — целое число дней от 1 до ${MAX_DEADLINE_DAYS}`,
    );
  }
  return days as number;
}

/** Причина отклонения заказа или видео. */
export function parseRejectComment(body: unknown): string {
  const comment = text((body as Record<string, unknown> | null)?.comment);
  if (!isMeaningfulText(comment))
    throw new BadRequestException('Напишите причину отклонения');
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new BadRequestException(
      `Причина длиннее ${MAX_COMMENT_LENGTH} символов`,
    );
  }
  return comment;
}
