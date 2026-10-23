import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ModeratorActionType,
  OrderStatus,
  PayoutStatus,
  Prisma,
  ReportTarget,
  SubmissionStatus,
} from '@prisma/client';
import { parseModeratorIds } from '../auth/moderator.util';
import { creatorLabel } from '../common/format';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { ModeratorActionsService } from './moderator-actions.service';

export const USERS_PAGE_SIZE = 30;
export type UsersFilter = 'all' | 'creators' | 'advertisers' | 'banned';

/** Заявки, которые уже не вернутся на баланс, — как HOLDS_BALANCE в PayoutsService. */
const SPENT_PAYOUTS = [PayoutStatus.REQUESTED, PayoutStatus.PAID];

/**
 * Вкладка «Люди» в окне модератора: все пользователи кроме модераторов (их не банят) и история
 * модерации по каждому — жалобы на него, решения по ним, блокировки и разблокировки.
 */
@Injectable()
export class ModUsersService {
  private readonly moderatorIds: bigint[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: ModeratorActionsService,
    config: ConfigService,
  ) {
    this.moderatorIds = [
      ...parseModeratorIds(config.get<string>('MODERATOR_IDS')),
    ].map((id) => BigInt(id));
  }

  /** Страница списка, новые первыми. `search` — @username, имя или Telegram ID. */
  async list(search: string, filter: UsersFilter, page: number) {
    const where: Prisma.UserWhereInput = {
      telegramId: { notIn: this.moderatorIds },
      ...(filter === 'creators' ? { submissions: { some: {} } } : {}),
      ...(filter === 'advertisers' ? { orders: { some: {} } } : {}),
      ...(filter === 'banned' ? { bannedAt: { not: null } } : {}),
      ...searchWhere(search),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: page * USERS_PAGE_SIZE,
        take: USERS_PAGE_SIZE,
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = users.map((u) => u.id);
    // счётчики страницы — несколькими запросами на всю страницу, а не по запросу на человека
    const [subs, approved, held, payouts, orders] = await Promise.all([
      this.prisma.submission.groupBy({
        by: ['creatorId'],
        where: { creatorId: { in: ids } },
        _count: true,
      }),
      this.prisma.submission.groupBy({
        by: ['creatorId'],
        where: {
          creatorId: { in: ids },
          status: SubmissionStatus.MODERATOR_APPROVED,
        },
        _count: true,
        _sum: { payoutMinor: true },
      }),
      this.prisma.submission.groupBy({
        by: ['creatorId'],
        where: {
          creatorId: { in: ids },
          status: SubmissionStatus.MODERATOR_APPROVED,
          finalizedAt: null,
        },
        _sum: { payoutMinor: true },
      }),
      this.prisma.payout.groupBy({
        by: ['creatorId'],
        where: { creatorId: { in: ids }, status: { in: SPENT_PAYOUTS } },
        _sum: { amountMinor: true },
      }),
      this.prisma.order.groupBy({
        by: ['advertiserId', 'status'],
        where: { advertiserId: { in: ids } },
        _count: true,
      }),
    ]);
    return {
      total,
      items: users.map((u) => {
        const ap = approved.find((a) => a.creatorId === u.id);
        const mine = orders.filter((o) => o.advertiserId === u.id);
        // доступно к выводу — как PayoutsService.balance: начислено − в холде − выплачено и в заявке
        const availableMinor = Math.max(
          0,
          (ap?._sum.payoutMinor ?? 0) -
            (held.find((h) => h.creatorId === u.id)?._sum.payoutMinor ?? 0) -
            (payouts.find((p) => p.creatorId === u.id)?._sum.amountMinor ?? 0),
        );
        return {
          id: u.id,
          label: creatorLabel(u),
          telegramId: u.telegramId.toString(),
          createdAt: u.createdAt,
          banned: u.bannedAt ? { at: u.bannedAt, reason: u.banReason } : null,
          creator: subs.some((s) => s.creatorId === u.id)
            ? {
                approved: ap?._count ?? 0,
                available: fromMinor(availableMinor),
              }
            : null,
          advertiser: mine.length
            ? {
                orders: mine.reduce((sum, o) => sum + o._count, 0),
                open:
                  mine.find((o) => o.status === OrderStatus.OPEN)?._count ?? 0,
              }
            : null,
        };
      }),
    };
  }

  /**
   * История модерации пользователя, новые первыми: жалобы на него (на профиль, его заказы, ролики и
   * отзывы), решения по ним, блокировки и разблокировки — с модератором и причиной. `ban` — текущая
   * блокировка и кто её поставил.
   */
  async history(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    // объекты, за которые отвечает пользователь, — как ReportsService.subject (authorId)
    const [orders, videos, reviews] = await Promise.all([
      this.prisma.order.findMany({
        where: { advertiserId: userId },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: { creatorId: userId },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: { order: { advertiserId: userId }, rating: { not: null } },
        select: { id: true },
      }),
    ]);
    const targets: { target: ReportTarget; targetId: { in: number[] } }[] = [
      { target: ReportTarget.PROFILE, targetId: { in: [userId] } },
      { target: ReportTarget.ORDER, targetId: { in: orders.map((o) => o.id) } },
      { target: ReportTarget.VIDEO, targetId: { in: videos.map((v) => v.id) } },
      {
        target: ReportTarget.REVIEW,
        targetId: { in: reviews.map((r) => r.id) },
      },
    ];
    const [reports, actions] = await Promise.all([
      this.prisma.report.findMany({
        where: { OR: targets },
        include: { reporter: true },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.moderatorAction.findMany({
        where: {
          OR: [
            {
              type: {
                in: [
                  ModeratorActionType.USER_BAN,
                  ModeratorActionType.USER_UNBAN,
                ],
              },
              objectId: userId,
            },
            ...targets.map(({ target, targetId }) => ({
              type: {
                in: [
                  ModeratorActionType.REPORT_ACTION,
                  ModeratorActionType.REPORT_DISMISS,
                ],
              },
              reportTarget: target,
              objectId: targetId,
            })),
          ],
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
    ]);
    const labels = await this.actions.labels([
      ...new Set(actions.map((a) => a.moderatorId.toString())),
    ]);
    const lastBan = actions.find(
      (a) => a.type === ModeratorActionType.USER_BAN,
    );
    const events = [
      ...reports.map((r) => ({
        kind: 'report' as const,
        at: r.createdAt,
        target: r.target,
        targetId: r.targetId,
        reason: r.reason,
        comment: r.comment,
        reporter: creatorLabel(r.reporter),
        reporterId: r.reporterId,
        status: r.status,
      })),
      ...actions.map((a) => ({
        kind: 'action' as const,
        at: a.createdAt,
        type: a.type,
        target: a.reportTarget,
        targetId: a.objectId,
        comment: a.comment,
        moderator: labels.get(a.moderatorId.toString()) ?? `id${a.moderatorId}`,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      ban: user.bannedAt
        ? {
            at: user.bannedAt,
            reason: user.banReason,
            // текущий бан — последняя запись о бане; до журнала модератор неизвестен
            by: lastBan
              ? (labels.get(lastBan.moderatorId.toString()) ??
                `id${lastBan.moderatorId}`)
              : null,
          }
        : null,
      events,
    };
  }
}

/** Поиск: «@name» и «name» — по username, текст — по имени, число — по Telegram ID и id. */
function searchWhere(raw: string): Prisma.UserWhereInput {
  const q = raw.trim().replace(/^@/, '');
  if (!q) return {};
  const or: Prisma.UserWhereInput[] = [
    { username: { contains: q, mode: 'insensitive' } },
    { firstName: { contains: q, mode: 'insensitive' } },
  ];
  // до 18 цифр — точно в пределах BigInt базы (int8)
  if (/^\d{1,18}$/.test(q)) {
    or.push({ telegramId: BigInt(q) });
    if (Number(q) <= 2_147_483_647) or.push({ id: Number(q) });
  }
  return { OR: or };
}
