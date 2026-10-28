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
  MAX_EXAMPLES,
  MIN_BUDGET,
  MIN_EXAMPLES,
  MAX_VIEWS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  VIDEO_URL_RE,
} from '../common/validation';
import { findExactContacts } from '../common/contacts';
import { toMinor } from '../common/money';
import { deadlineIn } from './deadline';
import {
  isTiktokShortLink,
  PLATFORMS,
  platformOf,
  videoIdKey,
} from '../common/platforms';

/**
 * Строка из формы: без невидимых символов форматирования — разворот текста (U+202E) подделал бы
 * вид названия в каталоге и у модератора. Склейку эмодзи (ZWJ, U+200D) оставляем.
 */
function text(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/(?!\u200d)\p{Cf}/gu, '').trim()
    : '';
}

/**
 * Тело `POST /api/my-orders` → данные для OrdersService.create. Нарушение — 400 с текстом,
 * который Mini App показывает пользователю. Обязательно всё, кроме брифа и ссылки на товар (с ней —
 * и «ссылка в шапке профиля»); «любая ориентация», «любая площадка» и «без срока» — явный выбор
 * (null / [] / null), не пропуск поля.
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

  const exampleUrls = parseExamples(b.exampleUrls);
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
  // в шапку креатор ставит свою ссылку /r/<код> на страницу товара — без товара ставить нечего
  if (b.linkInBio !== undefined && typeof b.linkInBio !== 'boolean')
    throw new BadRequestException(tr('errors.badLinkInBio'));
  const linkInBio = b.linkInBio === true;
  if (linkInBio && !targetUrl)
    throw new BadRequestException(tr('errors.linkInBioNeedsTarget'));

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

  const minViews = parseViews(b.minViews, tr('errors.thresholdWhat'));

  const minDurationSec = durationSec(b.minDurationSec);
  const maxDurationSec = durationSec(b.maxDurationSec);
  if (minDurationSec > maxDurationSec)
    throw new BadRequestException(tr('errors.durationOrder'));

  // null — любая ориентация; не передана — не выбрали.
  if (b.orientation === undefined)
    throw new BadRequestException(tr('errors.chooseOrientation'));
  const orientation = b.orientation as VideoOrientation | null;
  if (
    orientation !== null &&
    !Object.values(VideoOrientation).includes(orientation)
  )
    throw new BadRequestException(tr('errors.badOrientation'));

  // [] — любая площадка; не передано — не выбрали.
  if (b.platforms === undefined)
    throw new BadRequestException(tr('errors.choosePlatforms'));
  const platforms = b.platforms;
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

  // null — без срока; не передан — не выбрали.
  if (b.deadlineDays === undefined)
    throw new BadRequestException(tr('errors.chooseDeadline'));
  const deadline =
    b.deadlineDays === null
      ? undefined
      : deadlineIn(parseDeadlineDays(b.deadlineDays));

  return {
    title,
    description,
    exampleUrls,
    referenceUrl,
    targetUrl,
    linkInBio,
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
 * Примеры роликов: от MIN_EXAMPLES до MAX_EXAMPLES ссылок на конкретные ролики площадок, без
 * повторов (один ролик под разными ссылками — тоже повтор). Контакты не ищем: в ссылке ролика ник
 * автора есть всегда, а креатор её не видит — открывает через редирект (VideoLinkController).
 */
function parseExamples(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value.map((v) => text(v)).filter(Boolean)
    : [];
  if (list.length < MIN_EXAMPLES || list.length > MAX_EXAMPLES)
    throw new BadRequestException(
      tr('errors.examplesCount', { min: MIN_EXAMPLES, max: MAX_EXAMPLES }),
    );
  const keys = new Set<string>();
  for (const [i, url] of list.entries()) {
    const n = i + 1;
    if (
      !VIDEO_URL_RE.test(url) ||
      url.length > MAX_URL_LENGTH ||
      platformOf(url) === 'OTHER'
    )
      throw new BadRequestException(
        tr('errors.exampleNotVideo', {
          n,
          platforms: Object.values(PLATFORMS)
            .map((p) => p.name)
            .join(', '),
        }),
      );
    // короткую ссылку TikTok не раскрываем: по редиректу она откроется и так
    const key = videoIdKey(url) ?? (isTiktokShortLink(url) ? url : null);
    if (!key) throw new BadRequestException(tr('errors.exampleNotPost', { n }));
    if (keys.has(key))
      throw new BadRequestException(tr('errors.exampleDuplicate', { n }));
    keys.add(key);
  }
  return list;
}

/**
 * Ссылка заказа: пусто — без ссылки (undefined). Ссылка на мессенджер или соцсеть — это контакт
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

/** Подтверждённый модератором новый бюджет (доплата получена), USDT → центы; не передан — null. */
export function parseBudgetConfirmed(body: unknown): number | null {
  const value = (body as { budgetConfirmed?: unknown } | null)?.budgetConfirmed;
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_BUDGET
  )
    throw new BadRequestException('budgetConfirmed — сумма в USDT');
  return toMinor(value);
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

/** Длительность в секундах из требований — обязательна. */
function durationSec(value: unknown): number {
  if (value === undefined || value === null || value === '')
    throw new BadRequestException(tr('errors.durationRequired'));
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
  // срок при правке разбираем ниже: там «не передан» — не менять
  const input = parseOrderInput({ ...b, deadlineDays: null });
  return {
    title: input.title,
    description: input.description,
    exampleUrls: input.exampleUrls,
    referenceUrl: input.referenceUrl ?? null,
    targetUrl: input.targetUrl ?? null,
    linkInBio: input.linkInBio,
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
