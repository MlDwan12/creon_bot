import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

/**
 * Фильтр «Все заказы» у модератора: `?status=CLOSED,EXPIRED` — статусы через запятую;
 * пусто — все. Неизвестный статус — 400, а не тихо пустой список.
 */
export function parseStatusFilter(raw: unknown): OrderStatus[] {
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') throw new BadRequestException('status — строка');
  const all = Object.values(OrderStatus) as string[];
  const list = raw.split(',').map((s) => s.trim());
  const unknown = list.filter((s) => !all.includes(s));
  if (unknown.length)
    throw new BadRequestException(`status — из ${all.join(', ')}`);
  return list as OrderStatus[];
}
