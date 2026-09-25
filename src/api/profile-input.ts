import { BadRequestException } from '@nestjs/common';
import { findExactContacts } from '../common/contacts';
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
    throw new BadRequestException('Поставьте оценку от 1 до 5');

  const review = typeof b.review === 'string' ? b.review.trim() : '';
  if (review.length > MAX_COMMENT_LENGTH)
    throw new BadRequestException(
      `Отзыв длиннее ${MAX_COMMENT_LENGTH} символов`,
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
    throw new BadRequestException(
      `Уберите контакты (${found}) — общение между сторонами только через поддержку CreON`,
    );
}

const MAX_LINK_LENGTH = 200;

/** Соцсети креатора: поле → разрешённые домены (с поддоменами) и название для ошибки. */
const NETWORKS = {
  tiktokUrl: { name: 'TikTok', hosts: ['tiktok.com'] },
  youtubeUrl: { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  vkUrl: { name: 'VK', hosts: ['vk.com', 'vk.ru'] },
} as const;

type LinkField = keyof typeof NETWORKS;

/** Ссылки профиля: пустое — удалить ссылку; иначе https на домен своей соцсети. */
export function parseLinks(body: unknown): Record<LinkField, string | null> {
  const b = (body ?? {}) as Record<string, unknown>;
  const result = {} as Record<LinkField, string | null>;
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
    const host = url?.hostname.toLowerCase() ?? '';
    const ok =
      value.length <= MAX_LINK_LENGTH &&
      url?.protocol === 'https:' &&
      hosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok)
      throw new BadRequestException(
        `Ссылка на ${name} должна начинаться с https:// и вести на ${hosts.join(' или ')}`,
      );
    result[field] = url!.toString();
  }
  return result;
}
