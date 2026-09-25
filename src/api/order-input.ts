import { BadRequestException } from '@nestjs/common';
import { OrderCategory } from '@prisma/client';
import {
  isMeaningfulText,
  MAX_COMMENT_LENGTH,
  MAX_DEADLINE_DAYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE,
  MAX_TITLE_LENGTH,
} from '../common/validation';
import { rublesToKopecks } from '../common/money';
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

  // Пусто — «договорная». Иначе целые рубли за одно видео; в базу — копейками.
  const price =
    b.price === undefined || b.price === null || b.price === ''
      ? undefined
      : (b.price as number);
  if (
    price !== undefined &&
    (!Number.isInteger(price) || price < 1 || price > MAX_PRICE)
  ) {
    throw new BadRequestException(
      `Цена — целое число рублей от 1 до ${MAX_PRICE.toLocaleString('ru-RU')}`,
    );
  }

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
    priceKopecks: price === undefined ? undefined : rublesToKopecks(price),
    category,
    deadline,
  };
}

/**
 * Тело `PUT /api/my-orders/:id` — как при создании, кроме срока: `deadlineDays` не передан —
 * срок не меняется, null — без срока. Пустая цена — договорная.
 */
export function parseOrderEdit(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const input = parseOrderInput({ ...b, deadlineDays: undefined });
  return {
    title: input.title,
    description: input.description,
    priceKopecks: input.priceKopecks ?? null,
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
