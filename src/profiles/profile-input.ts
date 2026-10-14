import { tr } from '../i18n/request-lang';
import { BadRequestException } from '@nestjs/common';
import { findExactContacts } from '../common/contacts';
import { PLATFORMS, platformOf } from '../common/platforms';
import { isMeaningfulText, MAX_COMMENT_LENGTH } from '../common/validation';

/** Оценка при приёмке видео: звёзды обязательны, отзыв и согласие на портфолио — по желанию. */
export function parseFeedback(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const rating = b.rating;
  if (
    !Number.isInteger(rating) ||
    (rating as number) < 1 ||
    (rating as number) > 5
  )
    throw new BadRequestException(tr('errors.ratingRange'));

  const review = typeof b.review === 'string' ? b.review.trim() : '';
  if (review.length > MAX_COMMENT_LENGTH)
    throw new BadRequestException(
      tr('errors.reviewTooLong', { max: MAX_COMMENT_LENGTH }),
    );
  assertNoContacts(review);

  return {
    rating: rating as number,
    review: isMeaningfulText(review) ? review : null,
    portfolioAllowed: b.portfolioAllowed === true,
  };
}

/**
 * Текст, который уходит другой стороне сделки без модерации (отзыв, причина отказа), — без контактов:
 * стороны общаются только через площадку.
 */
export function assertNoContacts(text: string) {
  const [found] = findExactContacts(text);
  if (found)
    throw new BadRequestException(tr('errors.removeContacts', { found }));
}

const MAX_LINK_LENGTH = 200;
/** Ссылок в профиле — не больше: на площадке бывает несколько аккаунтов, но не десятки. */
export const MAX_SOCIAL_LINKS = 10;

/**
 * Ссылки профиля на соцсети (`{ links: string[] }`): каждая — https на домен одной из площадок
 * (src/common/platforms.ts), на одной площадке можно несколько. Пустые строки пропускаем,
 * повторы убираем, порядок сохраняем.
 */
export function parseLinks(body: unknown): string[] {
  const raw = (body as { links?: unknown } | null)?.links;
  if (!Array.isArray(raw))
    throw new BadRequestException(tr('errors.linksList'));
  const result: string[] = [];
  for (const item of raw) {
    const value = typeof item === 'string' ? item.trim() : '';
    if (!value) continue;
    let url: URL | undefined;
    try {
      url = new URL(value);
    } catch {
      // ниже — общая ошибка
    }
    const ok =
      value.length <= MAX_LINK_LENGTH &&
      url?.protocol === 'https:' &&
      platformOf(value) !== 'OTHER';
    if (!ok)
      throw new BadRequestException(
        tr('errors.socialLink', {
          link: value.slice(0, 60),
          platforms: Object.values(PLATFORMS)
            .map((p) => p.name)
            .join(', '),
        }),
      );
    const normalized = url!.toString();
    if (!result.includes(normalized)) result.push(normalized);
  }
  if (result.length > MAX_SOCIAL_LINKS)
    throw new BadRequestException(
      tr('errors.tooManyLinks', { max: MAX_SOCIAL_LINKS }),
    );
  return result;
}
