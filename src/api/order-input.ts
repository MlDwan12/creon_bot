import { BadRequestException } from '@nestjs/common';
import { OrderCategory } from '@prisma/client';
import {
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
  MAX_DEADLINE_DAYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE_LENGTH,
  MAX_TITLE_LENGTH,
} from '../bot/utils/validation';

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Тело `POST /api/my-orders` → данные для OrdersService.create. Те же правила, что в сцене
 * создания заказа в боте; нарушение — 400 с текстом, который Mini App показывает пользователю.
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

  const price = text(b.price) || undefined;
  if (price && price.length > MAX_PRICE_LENGTH) {
    throw new BadRequestException(
      `Бюджет длиннее ${MAX_PRICE_LENGTH} символов`,
    );
  }

  const category = b.category as OrderCategory;
  if (!Object.values(OrderCategory).includes(category)) {
    throw new BadRequestException('Выберите категорию');
  }

  let deadline: Date | undefined;
  if (b.deadlineDays !== undefined && b.deadlineDays !== null) {
    const days = b.deadlineDays;
    if (
      !Number.isInteger(days) ||
      (days as number) < 1 ||
      (days as number) > MAX_DEADLINE_DAYS
    ) {
      throw new BadRequestException(
        `Срок — целое число дней от 1 до ${MAX_DEADLINE_DAYS}`,
      );
    }
    deadline = new Date(Date.now() + (days as number) * DAY_MS);
  }

  return { title, description, price, category, deadline };
}

/** Причина отклонения видео — те же правила, что в сцене отклонения в боте. */
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
