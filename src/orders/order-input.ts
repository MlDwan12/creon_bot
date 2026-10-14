import { tr, trNum } from '../i18n/request-lang';
import { BadRequestException } from '@nestjs/common';
import { OrderCategory, VideoOrientation, VideoPlatform } from '@prisma/client';
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
import { toMinor } from '../common/money';
import { DEFAULT_MIN_VIEWS } from './budget';
import { deadlineIn } from './deadline';

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
    throw new BadRequestException(tr('errors.titleEmpty'));
  if (title.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(
      tr('errors.titleTooLong', { max: MAX_TITLE_LENGTH }),
    );
  }

  const description = text(b.description);
  if (!isMeaningfulText(description))
    throw new BadRequestException(tr('errors.briefEmpty'));
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      tr('errors.briefTooLong', { max: MAX_DESCRIPTION_LENGTH }),
    );
  }

  const referenceUrl = optionalUrl(
    b.referenceUrl,
    tr('errors.referenceWhat'),
    tr('errors.referenceInstead'),
  );
  const targetUrl = optionalUrl(
    b.targetUrl,
    tr('errors.targetWhat'),
    tr('errors.targetInstead'),
  );

  // Бюджет — всё, что платит рекламодатель, целыми USDT; в базу — центами.
  const budget = b.budget;
  if (
    !Number.isInteger(budget) ||
    (budget as number) < MIN_BUDGET ||
    (budget as number) > MAX_BUDGET
  )
    throw new BadRequestException(
      tr('errors.budgetRange', {
        min: trNum(MIN_BUDGET),
        max: trNum(MAX_BUDGET),
      }),
    );

  // Пусто — порог по умолчанию.
  const minViews =
    b.minViews === undefined || b.minViews === null || b.minViews === ''
      ? DEFAULT_MIN_VIEWS
      : parseViews(b.minViews, tr('errors.thresholdWhat'));

  const minDurationSec = durationSec(b.minDurationSec);
  const maxDurationSec = durationSec(b.maxDurationSec);
  if (minDurationSec && maxDurationSec && minDurationSec > maxDurationSec)
    throw new BadRequestException(tr('errors.durationOrder'));

  // Пусто — любая ориентация.
  const orientation = (b.orientation ?? null) as VideoOrientation | null;
  if (
    orientation !== null &&
    !Object.values(VideoOrientation).includes(orientation)
  )
    throw new BadRequestException(tr('errors.badOrientation'));

  // Пусто — любая площадка.
  const platforms = b.platforms ?? [];
  if (
    !Array.isArray(platforms) ||
    !platforms.every((p) =>
      Object.values(VideoPlatform).includes(p as VideoPlatform),
    )
  )
    throw new BadRequestException(tr('errors.badPlatform'));

  const category = b.category as OrderCategory;
  if (!Object.values(OrderCategory).includes(category)) {
    throw new BadRequestException(tr('errors.chooseCategory'));
  }

  const deadline =
    b.deadlineDays === undefined || b.deadlineDays === null
      ? undefined
      : deadlineIn(parseDeadlineDays(b.deadlineDays));

  return {
    title,
    description,
    referenceUrl,
    targetUrl,
    budgetMinor: toMinor(budget as number),
    minViews,
    minDurationSec,
    maxDurationSec,
    orientation,
    platforms: [...new Set(platforms as VideoPlatform[])],
    category,
    deadline,
  };
}

/**
 * Необязательная ссылка заказа: пусто — без ссылки. Ссылка на мессенджер или соцсеть — это контакт
 * в обход площадки. `what` и `instead` — для текста ошибки.
 */
function optionalUrl(value: unknown, what: string, instead: string) {
  const url = text(value) || undefined;
  if (url === undefined) return undefined;
  if (!VIDEO_URL_RE.test(url) || url.length > MAX_URL_LENGTH)
    throw new BadRequestException(tr('errors.urlScheme', { what }));
  if (findExactContacts(url).length)
    throw new BadRequestException(tr('errors.urlIsContact', { instead }));
  return url;
}

/** Требования к ролику из заказа — для ответов API, где поля перечислены явно. */
export function videoFormat(o: {
  minDurationSec: number | null;
  maxDurationSec: number | null;
  orientation: VideoOrientation | null;
  platforms: VideoPlatform[];
}) {
  return {
    minDurationSec: o.minDurationSec,
    maxDurationSec: o.maxDurationSec,
    orientation: o.orientation,
    platforms: o.platforms,
  };
}

/** Ставка креатору за 1000 просмотров (решает модератор): USDT, до центов; в базу — центами. */
export function parseCpm(body: unknown): number {
  const cpm = (body as { cpm?: unknown } | null)?.cpm;
  const minor =
    typeof cpm === 'number' && Number.isFinite(cpm) ? toMinor(cpm) : 0;
  if (minor < 1 || minor > MAX_CPM * 100)
    throw new BadRequestException(
      tr('errors.cpmRange', { max: trNum(MAX_CPM) }),
    );
  return minor;
}

/** Число просмотров: целое от 1 до MAX_VIEWS. `what` — для текста ошибки. */
export function parseViews(
  value: unknown,
  what = tr('errors.viewsWhat'),
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_VIEWS
  )
    throw new BadRequestException(
      tr('errors.viewsRange', { what, max: trNum(MAX_VIEWS) }),
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
      tr('errors.likesRange', { max: trNum(MAX_VIEWS) }),
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
      tr('errors.durationRange', { max: MAX_DURATION_SEC }),
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
    targetUrl: input.targetUrl ?? null,
    budgetMinor: input.budgetMinor,
    minViews: input.minViews,
    minDurationSec: input.minDurationSec,
    maxDurationSec: input.maxDurationSec,
    orientation: input.orientation,
    platforms: input.platforms,
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
      tr('errors.deadlineRange', { max: MAX_DEADLINE_DAYS }),
    );
  }
  return days as number;
}

/** Причина отклонения заказа или видео. */
export function parseRejectComment(body: unknown): string {
  const comment = text((body as Record<string, unknown> | null)?.comment);
  if (!isMeaningfulText(comment))
    throw new BadRequestException(tr('errors.rejectReason'));
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new BadRequestException(
      tr('errors.rejectTooLong', { max: MAX_COMMENT_LENGTH }),
    );
  }
  return comment;
}
