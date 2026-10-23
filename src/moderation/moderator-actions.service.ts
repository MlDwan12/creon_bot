import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ModeratorAction,
  ModeratorActionType,
  ReportStatus,
  type ReportTarget,
} from '@prisma/client';
import { parseModeratorIds } from '../auth/moderator.util';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const T = ModeratorActionType;

/** Подписи действий — в кабинете и CSV. Окно модератора только на русском. */
export const ACTION_LABELS: Record<ModeratorActionType, string> = {
  ORDER_APPROVE: 'Заказ опубликован',
  ORDER_REJECT: 'Заказ отклонён',
  VIDEO_APPROVE: 'Ролик одобрен',
  VIDEO_REJECT: 'Ролик отклонён',
  HOLD_FINALIZE: 'Итог холда',
  PUBLICATION_DELETED: 'Публикация удалена',
  REVIEW_APPROVE: 'Отзыв опубликован',
  REVIEW_REMOVE: 'Отзыв удалён',
  REPORT_ACTION: 'Жалоба: мера',
  REPORT_DISMISS: 'Жалоба: нарушений нет',
  PAYOUT_PAID: 'Выплата проведена',
  PAYOUT_REJECT: 'Выплата отклонена',
  USER_BAN: 'Блокировка',
  USER_UNBAN: 'Разблокировка',
};

/** Группы для медианы ожидания: сколько объект ждал решения этого модератора (по типу действия). */
const WAIT_GROUPS = [
  'orders',
  'videos',
  'holds',
  'reports',
  'payouts',
] as const;
type WaitGroup = (typeof WAIT_GROUPS)[number];

export type ModeratorStats = {
  moderatorId: string;
  label: string;
  /** Сколько действий каждого типа за период. */
  counts: Record<ModeratorActionType, number>;
  /** Проведено выплат, USDT. */
  paid: number;
  /** Медиана ожидания до решения, секунды; null — решений этого вида не было. */
  medianWaitSec: Record<WaitGroup, number | null>;
};

/**
 * Журнал решений модераторов: запись — из контроллера модерации сразу после решения, чтение —
 * кабинет модератора (/mod/me), таблица команды и выгрузка CSV.
 * ponytail: строка пишется отдельным запросом после решения, а не в его транзакции — упадёт
 * процесс ровно между ними, в журнале не будет одной строки; для статистики не страшно.
 */
@Injectable()
export class ModeratorActionsService {
  private readonly moderatorIds: string[];

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.moderatorIds = [
      ...parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    ];
  }

  log(entry: {
    moderatorId: bigint;
    type: ModeratorActionType;
    objectId: number;
    reportTarget?: ReportTarget;
    amountMinor?: number | null;
    /** С какого момента объект ждал решения. */
    waitingSince?: Date | null;
  }) {
    const { waitingSince, ...data } = entry;
    return this.prisma.moderatorAction.create({
      data: {
        ...data,
        waitedSec: waitingSince
          ? Math.max(
              0,
              Math.round((Date.now() - waitingSince.getTime()) / 1000),
            )
          : null,
      },
    });
  }

  /** С какого момента ждут открытые жалобы на объект — до решения по ним. */
  async reportsWaitingSince(target: ReportTarget, targetId: number) {
    const { _min } = await this.prisma.report.aggregate({
      where: { target, targetId, status: ReportStatus.OPEN },
      _min: { createdAt: true },
    });
    return _min.createdAt;
  }

  /** Сводка по каждому модератору за период (с `since`; без него — всё время), все из MODERATOR_IDS. */
  async stats(since?: Date): Promise<ModeratorStats[]> {
    const from = since ?? new Date(0);
    const [rows, waits] = await Promise.all([
      this.prisma.moderatorAction.groupBy({
        by: ['moderatorId', 'type'],
        where: { createdAt: { gte: from } },
        _count: true,
        _sum: { amountMinor: true },
      }),
      this.prisma.$queryRaw<
        { moderatorId: bigint; grp: WaitGroup; median: number }[]
      >`
        SELECT "moderatorId",
               CASE WHEN "type" IN ('ORDER_APPROVE', 'ORDER_REJECT') THEN 'orders'
                    WHEN "type" IN ('VIDEO_APPROVE', 'VIDEO_REJECT') THEN 'videos'
                    WHEN "type" IN ('HOLD_FINALIZE', 'PUBLICATION_DELETED') THEN 'holds'
                    WHEN "type" IN ('REPORT_ACTION', 'REPORT_DISMISS') THEN 'reports'
                    WHEN "type" IN ('PAYOUT_PAID', 'PAYOUT_REJECT') THEN 'payouts' END AS grp,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "waitedSec") AS median
        FROM "ModeratorAction"
        WHERE "createdAt" >= ${from} AND "waitedSec" IS NOT NULL
        GROUP BY 1, 2`,
    ]);
    // в журнале бывают и бывшие модераторы — их тоже показываем, решения-то их
    const ids = [
      ...new Set([
        ...this.moderatorIds,
        ...rows.map((r) => r.moderatorId.toString()),
      ]),
    ];
    const labels = await this.labels(ids);
    return ids.map((id) => {
      const mine = rows.filter((r) => r.moderatorId.toString() === id);
      const counts = Object.fromEntries(
        Object.values(T).map((type) => [
          type,
          mine.find((r) => r.type === type)?._count ?? 0,
        ]),
      ) as Record<ModeratorActionType, number>;
      const paidMinor =
        mine.find((r) => r.type === T.PAYOUT_PAID)?._sum.amountMinor ?? 0;
      return {
        moderatorId: id,
        label: labels.get(id) ?? `id${id}`,
        counts,
        paid: fromMinor(paidMinor),
        medianWaitSec: Object.fromEntries(
          WAIT_GROUPS.map((group) => {
            const w = waits.find(
              (x) => x.moderatorId.toString() === id && x.grp === group,
            );
            return [group, w ? Math.round(Number(w.median)) : null];
          }),
        ) as Record<WaitGroup, number | null>,
      };
    });
  }

  /** Последние действия модератора — список в кабинете. */
  recent(moderatorId: bigint, take = 20) {
    return this.prisma.moderatorAction.findMany({
      where: { moderatorId },
      orderBy: { id: 'desc' },
      take,
    });
  }

  /**
   * Все действия за период файлом CSV: одного модератора или всей команды. Формат как у отчёта
   * заказчику (src/orders/order-report.ts): `;` и BOM — для русской Excel.
   */
  async csv(since: Date | undefined, moderatorId?: bigint) {
    const actions = await this.prisma.moderatorAction.findMany({
      where: {
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(moderatorId === undefined ? {} : { moderatorId }),
      },
      orderBy: { id: 'asc' },
    });
    const labels = await this.labels([
      ...new Set(actions.map((a) => a.moderatorId.toString())),
    ]);
    return actionsCsv(actions, labels);
  }

  /** Имена модераторов: @username или имя из Telegram — если модератор хоть раз открывал мини-апп. */
  private async labels(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { telegramId: { in: ids.map((id) => BigInt(id)) } },
      select: { telegramId: true, username: true, firstName: true },
    });
    return new Map(
      users.map((u) => [
        u.telegramId.toString(),
        u.username ? `@${u.username}` : (u.firstName ?? `id${u.telegramId}`),
      ]),
    );
  }
}

export function actionsCsv(
  actions: Pick<
    ModeratorAction,
    | 'moderatorId'
    | 'type'
    | 'objectId'
    | 'reportTarget'
    | 'amountMinor'
    | 'waitedSec'
    | 'createdAt'
  >[],
  labels: Map<string, string>,
): string {
  const cell = (value: string | number) => {
    const text = String(value);
    // имя модератора из Telegram — ячейку, похожую на формулу, экранируем апострофом
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['Дата', 'Модератор', 'Действие', 'Объект', 'Сумма, USDT', 'Ждал, мин'],
    ...actions.map((a) => [
      a.createdAt.toISOString(),
      labels.get(a.moderatorId.toString()) ?? `id${a.moderatorId}`,
      ACTION_LABELS[a.type],
      `${a.reportTarget ? `${a.reportTarget} ` : ''}#${a.objectId}`,
      a.amountMinor === null ? '' : fromMinor(a.amountMinor),
      a.waitedSec === null ? '' : Math.round(a.waitedSec / 60),
    ]),
  ];
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
