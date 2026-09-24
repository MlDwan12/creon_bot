export const DAY_MS = 24 * 60 * 60 * 1000;

/** Срок через `days` дней от `from`. */
export function deadlineIn(days: number, from = new Date()): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Новый срок при продлении: прибавляем к текущему, если он ещё не прошёл, иначе — к «сейчас»
 * (продление истёкшего заказа даёт полные `days` дней, а не остаток в прошлом).
 */
export function extendedDeadline(
  current: Date | null,
  days: number,
  now = new Date(),
): Date {
  const base = current && current > now ? current : now;
  return deadlineIn(days, base);
}
