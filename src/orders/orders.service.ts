import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Order,
  OrderCategory,
  OrderStatus,
  Prisma,
  SubmissionStatus,
  VideoOrientation,
} from '@prisma/client';
import { formatMoney } from '../common/format';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCRUED,
  budgetState,
  HOLDS_MONEY,
  NO_VIDEO,
  ORDER_CURRENCY,
  payoutPool,
  platformFeePercent,
  spentByOrder,
} from './budget';
import { DAY_MS, extendedDeadline } from './deadline';
import { type OrderFunnel, orderInsights } from './order-insights';
import { buildOrderReport } from './order-report';
import {
  closeOpenOrders,
  lockOrder,
  transitionOrder,
  tryTransitionOrder,
} from './order-status';
import { expireSlots, rejectSubmitted } from '../submissions/submission-status';

/** Поля заказа, которые видит любой пользователь Mini App: без модераторских данных и без BigInt. */
const PUBLIC_ORDER_FIELDS = {
  id: true,
  title: true,
  description: true,
  referenceUrl: true,
  budgetMinor: true,
  feePercent: true,
  cpmMinor: true,
  minViews: true,
  minDurationSec: true,
  maxDurationSec: true,
  orientation: true,
  category: true,
  deadline: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

/** Сколько заказов у рекламодателя может быть одновременно на модерации и открытыми. */
export const MAX_ACTIVE_ORDERS = 10;

/**
 * Решение модератора — только по той версии заказа, которую он видел: рекламодатель мог изменить
 * заказ, пока модератор его читал.
 */
const CHANGED_WHILE_VIEWED =
  'Заказ уже обработан или изменён, пока вы его смотрели — откройте его заново';

/** Сколько живёт число «N открытых заказов» в заголовке каталога. */
const OPEN_COUNT_TTL_MS = 30_000;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ponytail: кэш в памяти процесса — пока инстанс один; заголовок может отставать на 30 с.
  private readonly openCounts = new Map<
    string,
    { value: number; at: number }
  >();

  // ponytail: count и create не атомарны — два одновременных запроса могут дать 11-й заказ.
  // Спам этим не сделать: создание ещё и ограничено по частоте (@Throttle в контроллере).
  async create(
    advertiserId: number,
    data: {
      title: string;
      description: string;
      referenceUrl?: string;
      budgetMinor: number;
      minViews: number;
      minDurationSec?: number | null;
      maxDurationSec?: number | null;
      orientation?: VideoOrientation | null;
      category: OrderCategory;
      deadline?: Date;
    },
  ) {
    const active = await this.prisma.order.count({
      where: {
        advertiserId,
        status: { in: [OrderStatus.PENDING_MODERATION, OrderStatus.OPEN] },
      },
    });
    if (active >= MAX_ACTIVE_ORDERS)
      throw new ForbiddenException(
        `У вас уже ${MAX_ACTIVE_ORDERS} активных заказов — закройте ненужные, чтобы разместить новый`,
      );
    return this.prisma.order.create({
      data: {
        advertiserId,
        title: data.title,
        description: data.description,
        referenceUrl: data.referenceUrl,
        currency: ORDER_CURRENCY,
        budgetMinor: data.budgetMinor,
        feePercent: platformFeePercent(),
        minViews: data.minViews,
        minDurationSec: data.minDurationSec,
        maxDurationSec: data.maxDurationSec,
        orientation: data.orientation,
        category: data.category,
        deadline: data.deadline,
      },
      include: { advertiser: true },
    });
  }

  /**
   * Страница открытых заказов для каталога Mini App, новые первыми. `after` — последний показанный
   * заказ: следующая страница — то, что старше него (курсор, а не смещение: закрылся или появился
   * заказ, пока листали, — страницы не съезжают). `hasMore` — есть ли ещё (берём на один больше).
   * `total` — только для заголовка, из кэша: каталог открывают чаще всего, а под нагрузкой каждый
   * лишний запрос к базе — это CPU.
   */
  async listOpen(
    category: OrderCategory | undefined,
    after: { createdAt: Date; id: number } | undefined,
    take: number,
  ) {
    const where = {
      status: OrderStatus.OPEN,
      ...(category ? { category } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where: after
          ? {
              ...where,
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        select: PUBLIC_ORDER_FIELDS,
      }),
      this.countOpen(category ?? 'ALL', where),
    ]);
    return {
      items: await this.withFree(rows.slice(0, take)),
      hasMore: rows.length > take,
      total,
    };
  }

  /** Свободный остаток фонда выплат к каждому заказу — креаторы видят его в каталоге. */
  private async withFree<
    T extends { id: number } & Parameters<typeof budgetState>[0],
  >(orders: T[]) {
    const spent = await spentByOrder(
      this.prisma,
      orders.map((o) => o.id),
    );
    return orders.map((o) => ({
      ...o,
      freeMinor: budgetState(o, spent.get(o.id) ?? 0).free,
    }));
  }

  private async countOpen(key: string, where: Prisma.OrderWhereInput) {
    const cached = this.openCounts.get(key);
    if (cached && Date.now() - cached.at < OPEN_COUNT_TTL_MS)
      return cached.value;
    const value = await this.prisma.order.count({ where });
    this.openCounts.set(key, { value, at: Date.now() });
    return value;
  }

  /** Открытый заказ для карточки в Mini App; `advertiserId` — только чтобы узнать «свой ли», наружу не отдавать. */
  async findOpenById(id: number) {
    const order = await this.prisma.order.findFirst({
      where: { id, status: OrderStatus.OPEN },
      select: { ...PUBLIC_ORDER_FIELDS, advertiserId: true },
    });
    return order && (await this.withFree([order]))[0];
  }

  /** Очередь модератора в Mini App: все заказы на проверке, дольше ждущие первыми. */
  listPending() {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_MODERATION },
      // после правки заказ встаёт в очередь заново — ждёт с момента отправки, а не создания
      orderBy: { moderationRequestedAt: 'asc' },
      include: { advertiser: true },
    });
  }

  /** Сколько заказов ждёт модератора с момента раньше `before` — для напоминания. */
  countPendingBefore(before: Date) {
    return this.prisma.order.count({
      where: {
        status: OrderStatus.PENDING_MODERATION,
        moderationRequestedAt: { lt: before },
      },
    });
  }

  /** Все заказы любого статуса для модератора — страница, новые первыми. */
  async listAll(skip: number, take: number) {
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          advertiser: true,
          _count: { select: { submissions: true } },
        },
      }),
      this.prisma.order.count(),
    ]);
    return { items, total };
  }

  findWithAdvertiser(id: number) {
    return this.prisma.order.findUnique({
      where: { id },
      include: { advertiser: true },
    });
  }

  /**
   * «Мои заказы» со сводкой по откликам. Сводка — агрегатами в базе: у заказа могут быть тысячи
   * откликов, а грузить их ради сумм незачем.
   */
  async listByAdvertiser(advertiserId: number) {
    const orders = await this.prisma.order.findMany({
      where: { advertiserId },
      orderBy: { createdAt: 'desc' },
    });
    const orderId = { in: orders.map((o) => o.id) };
    const [byStatus, toRate] = await Promise.all([
      this.prisma.submission.groupBy({
        by: ['orderId', 'status'],
        where: { orderId },
        _count: true,
        _sum: { payoutMinor: true, views: true },
      }),
      this.prisma.submission.groupBy({
        by: ['orderId'],
        where: {
          orderId,
          status: SubmissionStatus.MODERATOR_APPROVED,
          rating: null,
        },
        _count: true,
      }),
    ]);
    return orders.map((o) => {
      const rows = byStatus.filter((r) => r.orderId === o.id);
      const approved = rows.find(
        (r) => r.status === SubmissionStatus.MODERATOR_APPROVED,
      );
      return {
        ...o,
        stats: {
          submissions: rows.reduce((n, r) => n + r._count, 0),
          approved: approved?._count ?? 0,
          views: approved?._sum.views ?? 0,
          toRate: toRate.find((r) => r.orderId === o.id)?._count ?? 0,
          // резерв роликов на проверке тоже занимает фонд — как в src/orders/budget.ts
          spentMinor: rows
            .filter((r) => HOLDS_MONEY.includes(r.status))
            .reduce((n, r) => n + (r._sum.payoutMinor ?? 0), 0),
          // та же проверка, что в remove
          deletable: rows.every((r) => NO_VIDEO.includes(r.status)),
        },
      };
    });
  }

  findById(id: number) {
    return this.prisma.order.findUnique({ where: { id } });
  }

  async close(orderId: number, advertiserId: number) {
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    await transitionOrder(
      this.prisma,
      orderId,
      [OrderStatus.OPEN],
      { status: OrderStatus.CLOSED, closedAt: new Date() },
      'Закрыть можно только открытый заказ',
    );
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { submissions: { include: { creator: true } } },
    });
  }

  /**
   * Модератор закрывает открытый заказ (по жалобе). `null` — заказ уже не открыт: закрывать нечего.
   * В отличие от закрытия рекламодателем, начатые ролики по нему не принимаются: слоты сгорают.
   * Возвращает заказ с рекламодателем и откликами — для уведомлений.
   */
  async moderatorClose(orderId: number) {
    const closed = await this.prisma.$transaction(async (tx) => {
      const count = await closeOpenOrders(tx, [orderId]);
      if (count > 0) await expireSlots(tx, [orderId]);
      return count > 0;
    });
    if (!closed) return null;
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        advertiser: true,
        submissions: { include: { creator: true } },
      },
    });
  }

  /**
   * Продление срока: открытый заказ — сдвигаем срок, истёкший — сдвигаем и открываем снова.
   * Закрытый вручную не трогаем: его рекламодатель закрыл сам.
   */
  async extend(orderId: number, advertiserId: number, days: number) {
    const order = await this.mustFind(orderId);
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    await transitionOrder(
      this.prisma,
      orderId,
      [OrderStatus.OPEN, OrderStatus.EXPIRED],
      {
        status: OrderStatus.OPEN,
        deadline: extendedDeadline(order.deadline, days),
        closedAt: null,
        deadlineReminderSentAt: null,
      },
      'Продлить можно только открытый заказ или заказ с истёкшим сроком',
    );
  }

  /** Открытые заказы, у которых срок истекает меньше чем через сутки, а напоминания ещё не было. */
  listDeadlineSoon() {
    const now = Date.now();
    return this.prisma.order.findMany({
      where: {
        status: OrderStatus.OPEN,
        deadline: { gt: new Date(now), lt: new Date(now + DAY_MS) },
        deadlineReminderSentAt: null,
      },
      select: { id: true },
    });
  }

  /**
   * Отмечает, что напоминание о сроке отправлено, и возвращает заказ с креаторами «в работе».
   * `null` — уже отмечено (или заказ продлили/закрыли): второй раз не напоминаем.
   */
  async markDeadlineReminded(orderId: number) {
    const { count } = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.OPEN,
        deadlineReminderSentAt: null,
      },
      data: { deadlineReminderSentAt: new Date() },
    });
    if (count === 0) return null;
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        submissions: {
          where: { status: SubmissionStatus.IN_PROGRESS },
          include: { creator: true },
        },
      },
    });
  }

  /** Открытые заказы с прошедшим сроком — кандидаты на автозакрытие. */
  listOverdue() {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.OPEN, deadline: { lt: new Date() } },
      select: { id: true },
    });
  }

  /**
   * Закрывает заказ по сроку. Условие повторено в `updateMany`: если рекламодатель успел продлить,
   * заказ не закроется. `null` — закрывать уже не нужно.
   */
  async expire(orderId: number) {
    const count = await tryTransitionOrder(
      this.prisma,
      orderId,
      [OrderStatus.OPEN],
      { status: OrderStatus.EXPIRED, closedAt: new Date() },
      { deadline: { lt: new Date() } },
    );
    if (count === 0) return null;
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        advertiser: true,
        submissions: {
          where: { status: SubmissionStatus.IN_PROGRESS },
          include: { creator: true },
        },
      },
    });
  }

  /**
   * Удаляет заказ вместе с откликами — только пока по нему никто не сдал видео: сданные работы
   * нужны для разбора споров. Условие в самом `deleteMany`, поэтому видео, сданное между
   * проверкой и удалением, удаление остановит.
   */
  async remove(orderId: number, advertiserId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { submissions: { include: { creator: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    const { count } = await this.prisma.order.deleteMany({
      where: {
        id: orderId,
        submissions: { none: { status: { notIn: NO_VIDEO } } },
      },
    });
    if (count === 0)
      throw new ForbiddenException(
        'По заказу уже сдавали видео — удалить его нельзя, только закрыть',
      );
    return order;
  }

  /**
   * Правка своего заказа: на проверке — остаётся на проверке, открытый — уходит на повторную
   * (пропадает из каталога до одобрения: новые условия видит модератор, в том числе контакты).
   * `deadline`: undefined — не менять, null — без срока. Возвращает заказ с рекламодателем и
   * креаторами, которые уже работают по нему (отклики бывают, только если заказ публиковали).
   */
  async update(
    orderId: number,
    advertiserId: number,
    data: {
      title: string;
      description: string;
      referenceUrl?: string | null;
      budgetMinor: number;
      minViews: number;
      minDurationSec?: number | null;
      maxDurationSec?: number | null;
      orientation?: VideoOrientation | null;
      category: OrderCategory;
      deadline?: Date | null;
    },
  ) {
    const order = await this.mustFind(orderId);
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    const now = new Date();
    // Срок «как было» у заказа на проверке — это ещё «N дней от отправки на проверку»: переносим его
    // вместе с моментом отправки, иначе время до правки съело бы дни креаторов.
    let deadline = data.deadline;
    if (
      deadline === undefined &&
      order.deadline &&
      order.status === OrderStatus.PENDING_MODERATION
    )
      deadline = new Date(
        order.deadline.getTime() +
          (now.getTime() - order.moderationRequestedAt.getTime()),
      );
    await this.prisma.$transaction(async (tx) => {
      // Резерв при сдаче ролика берёт ту же блокировку — занятое не вырастет между проверкой и записью.
      await lockOrder(tx, orderId);
      const spent = (await spentByOrder(tx, [orderId])).get(orderId) ?? 0;
      if (payoutPool({ ...order, budgetMinor: data.budgetMinor }) < spent)
        throw new ForbiddenException(
          `Из бюджета уже потрачено или зарезервировано ${formatMoney(fromMinor(spent))} выплат креаторам — бюджет нельзя сделать меньше`,
        );
      await transitionOrder(
        tx,
        orderId,
        [OrderStatus.PENDING_MODERATION, OrderStatus.OPEN],
        {
          ...data,
          deadline,
          status: OrderStatus.PENDING_MODERATION,
          moderationRequestedAt: now,
          moderatorId: null,
          decidedAt: null,
          deadlineReminderSentAt: null,
        },
        'Изменить можно только заказ на проверке или открытый',
      );
    });
    return this.withActiveCreators(orderId);
  }

  /** Заказ с рекламодателем и креаторами, чья работа по нему ещё не решена, — для уведомлений. */
  private withActiveCreators(orderId: number) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        advertiser: true,
        submissions: {
          where: {
            status: {
              in: [
                SubmissionStatus.IN_PROGRESS,
                SubmissionStatus.SUBMITTED,
                SubmissionStatus.MODERATOR_APPROVED,
              ],
            },
          },
          include: { creator: true },
        },
      },
    });
  }

  /**
   * Публикация. Срок в форме — «N дней» от отправки на проверку: сдвигаем его на время модерации,
   * чтобы у креаторов было ровно N дней с момента публикации (после правки — сколько оставалось).
   * Изменённый заказ, пока был на проверке, мог израсходовать фонд одобренными роликами (закрывает
   * исчерпанные только SubmissionsService и только открытые) — тогда он сразу закрывается.
   */
  async moderatorApprove(
    orderId: number,
    moderatorTelegramId: bigint,
    version: Date,
    cpmMinor: number,
  ) {
    const order = await this.mustFind(orderId);
    // Ставка, при которой фонд не покрывает даже один ролик с порогом, — заказ сразу исчерпан.
    if (budgetState({ ...order, cpmMinor }, 0).exhausted)
      throw new ForbiddenException(
        'Фонда выплат не хватит даже на один ролик с порогом просмотров — уменьшите ставку',
      );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // та же блокировка, что у начислений в SubmissionsService — начисленное не вырастет до записи
      await lockOrder(tx, orderId);
      const accrued =
        (await spentByOrder(tx, [orderId], ACCRUED)).get(orderId) ?? 0;
      const exhausted = budgetState({ ...order, cpmMinor }, accrued).exhausted;
      await transitionOrder(
        tx,
        orderId,
        [OrderStatus.PENDING_MODERATION],
        {
          status: exhausted ? OrderStatus.CLOSED : OrderStatus.OPEN,
          ...(exhausted && { closedAt: now }),
          moderatorId: moderatorTelegramId,
          cpmMinor,
          decidedAt: now,
          deadline: order.deadline
            ? new Date(
                order.deadline.getTime() +
                  (now.getTime() - order.moderationRequestedAt.getTime()),
              )
            : null,
        },
        CHANGED_WHILE_VIEWED,
        { moderationRequestedAt: version },
      );
    });
    const approved = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        advertiser: true,
        submissions: {
          where: { status: SubmissionStatus.IN_PROGRESS },
          include: { creator: true },
        },
      },
    });
    // ставку назначают при первом одобрении, правка заказа её не сбрасывает
    return { ...approved, firstPublication: order.cpmMinor === null };
  }

  /**
   * Возвращает заказ с креаторами, чья работа по нему не решена: отклонить можно и изменённый
   * открытый заказ — тогда им надо сказать, что работа по нему больше не нужна.
   */
  async moderatorReject(
    orderId: number,
    moderatorTelegramId: bigint,
    comment: string,
    version: Date,
  ) {
    // креаторы — до снятия: их ролики на проверке сейчас станут отклонёнными
    const order = await this.withActiveCreators(orderId);
    await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      await transitionOrder(
        tx,
        orderId,
        [OrderStatus.PENDING_MODERATION],
        {
          status: OrderStatus.REJECTED,
          moderatorId: moderatorTelegramId,
          moderatorComment: comment,
          decidedAt: new Date(),
        },
        CHANGED_WHILE_VIEWED,
        { moderationRequestedAt: version },
      );
      // Изменённый открытый заказ сняли — ролики на проверке не ждут модератора, резерв
      // освобождается. Одобренные остаются: деньги за них уже начислены.
      await rejectSubmitted(
        tx,
        { orderId: { in: [orderId] } },
        'Заказ снят модератором',
      );
    });
    return { ...order, status: OrderStatus.REJECTED };
  }

  async stats() {
    const [pending, open, rejected, closed, total] = await Promise.all([
      this.prisma.order.count({
        where: { status: OrderStatus.PENDING_MODERATION },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.OPEN } }),
      this.prisma.order.count({ where: { status: OrderStatus.REJECTED } }),
      // «закрыто» — и вручную, и по сроку
      this.prisma.order.count({
        where: { status: { in: [OrderStatus.CLOSED, OrderStatus.EXPIRED] } },
      }),
      this.prisma.order.count(),
    ]);
    return { pending, open, rejected, closed, total };
  }

  /** Креатор открыл карточку заказа — для воронки в отчёте; повторное открытие не считается. */
  async markViewed(orderId: number, userId: number) {
    await this.prisma.orderView.createMany({
      data: [{ orderId, userId }],
      skipDuplicates: true,
    });
  }

  /** Отчёт рекламодателю: сводка и ролики, воронка и советы, что поправить. */
  async report(order: Order) {
    const [rows, viewers, byStatus] = await Promise.all([
      this.prisma.submission.findMany({
        where: { orderId: order.id, status: { in: HOLDS_MONEY } },
        include: { creator: true },
      }),
      this.prisma.orderView.count({ where: { orderId: order.id } }),
      this.prisma.submission.groupBy({
        by: ['status'],
        where: { orderId: order.id },
        _count: true,
      }),
    ]);
    const count = (status: SubmissionStatus) =>
      byStatus.find((r) => r.status === status)?._count ?? 0;
    const funnel: OrderFunnel = {
      viewers,
      taken: byStatus.reduce((sum, r) => sum + r._count, 0),
      expired: count(SubmissionStatus.SLOT_EXPIRED),
      onReview: count(SubmissionStatus.SUBMITTED),
      rejected: count(SubmissionStatus.MODERATOR_REJECTED),
      approved: count(SubmissionStatus.MODERATOR_APPROVED),
    };
    const report = buildOrderReport(order, rows);
    return {
      ...report,
      funnel,
      insights: orderInsights(order, report, funnel),
    };
  }

  /** Открытые заказы, по которым советы ещё не отправляли. */
  listInsightsPending() {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.OPEN, insightsSentAt: null },
      include: { advertiser: true },
    });
  }

  /** Отметить, что советы отправлены; false — уже отметил другой проход. */
  async markInsightsSent(orderId: number) {
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, insightsSentAt: null },
      data: { insightsSentAt: new Date() },
    });
    return count > 0;
  }

  private async mustFind(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }
}
