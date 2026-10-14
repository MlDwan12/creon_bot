import { tr } from '../i18n/request-lang';
import { BadRequestException } from '@nestjs/common';
import { findExactContacts } from '../common/contacts';
import { isOnHosts, PLATFORMS } from '../common/platforms';
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

/** Соцсети креатора: поле → разрешённые домены (с поддоменами) и название для ошибки. */
const NETWORKS = {
  tiktokUrl: PLATFORMS.TIKTOK,
  youtubeUrl: PLATFORMS.YOUTUBE,
  vkUrl: PLATFORMS.VK,
  instagramUrl: PLATFORMS.INSTAGRAM,
  xUrl: PLATFORMS.X,
} as const;

type LinkField = keyof typeof NETWORKS;
export type ProfileLinks = Record<LinkField, string | null>;

/** Все ссылки пустые — чужому (без права видеть контакты) и при сбросе профиля по жалобе. */
export const NO_LINKS: ProfileLinks = {
  tiktokUrl: null,
  youtubeUrl: null,
  vkUrl: null,
  instagramUrl: null,
  xUrl: null,
};

/** Ссылки профиля: пустое — удалить ссылку; иначе https на домен своей соцсети. */
export function parseLinks(body: unknown): ProfileLinks {
  const b = (body ?? {}) as Record<string, unknown>;
  const result = { ...NO_LINKS };
  for (const field of Object.keys(NETWORKS) as LinkField[]) {
    const { name, hosts } = NETWORKS[field];
    const value = typeof b[field] === 'string' ? b[field].trim() : '';
    if (!value) {
      result[field] = null;
      continue;
    }
    let url: URL | undefined;
    try {
      url = new URL(value);
    } catch {
      // ниже — общая ошибка
    }
    const ok =
      value.length <= MAX_LINK_LENGTH &&
      url?.protocol === 'https:' &&
      isOnHosts(url.hostname, hosts);
    if (!ok)
      throw new BadRequestException(
        tr('errors.profileLink', { name, hosts: hosts.join(tr('errors.or')) }),
      );
    result[field] = url!.toString();
  }
  return result;
}
