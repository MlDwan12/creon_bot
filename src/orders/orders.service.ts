import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderCategory,
  OrderStatus,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, extendedDeadline } from './deadline';

/** Поля заказа, которые видит любой пользователь Mini App: без модераторских данных и без BigInt. */
const PUBLIC_ORDER_FIELDS = {
  id: true,
  title: true,
  description: true,
  priceKopecks: true,
  category: true,
  deadline: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

/** Сколько заказов у рекламодателя может быть одновременно на модерации и открытыми. */
export const MAX_ACTIVE_ORDERS = 10;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ponytail: count и create не атомарны — два одновременных запроса могут дать 11-й заказ.
  // Спам этим не сделать: создание ещё и ограничено по частоте (@Throttle в контроллере).
  async create(
    advertiserId: number,
    data: {
      title: string;
      description: string;
      priceKopecks?: number;
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
        priceKopecks: data.priceKopecks,
        category: data.category,
        deadline: data.deadline,
      },
      include: { advertiser: true },
    });
  }

  /** Страница открытых заказов для каталога Mini App. */
  async listOpen(
    category: OrderCategory | undefined,
    skip: number,
    take: number,
  ) {
    const where = {
      status: OrderStatus.OPEN,
      ...(category ? { category } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: PUBLIC_ORDER_FIELDS,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  /** Открытый заказ для карточки в Mini App; `advertiserId` — только чтобы узнать «свой ли», наружу не отдавать. */
  findOpenById(id: number) {
    return this.prisma.order.findFirst({
      where: { id, status: OrderStatus.OPEN },
      select: { ...PUBLIC_ORDER_FIELDS, advertiserId: true },
    });
  }

  /** Очередь модератора в Mini App: все заказы на проверке, старые первыми. */
  listPending() {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_MODERATION },
      orderBy: { createdAt: 'asc' },
      include: { advertiser: true },
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

  listByAdvertiser(advertiserId: number) {
    return this.prisma.order.findMany({
      where: { advertiserId },
      orderBy: { createdAt: 'desc' },
      include: { submissions: true },
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
    await this.transitionStatus(
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
   * Возвращает заказ с рекламодателем и откликами — для уведомлений.
   */
  async moderatorClose(orderId: number) {
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.OPEN },
      data: { status: OrderStatus.CLOSED, closedAt: new Date() },
    });
    if (count === 0) return null;
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
    await this.transitionStatus(
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
    const { count } = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.OPEN,
        deadline: { lt: new Date() },
      },
      data: { status: OrderStatus.EXPIRED, closedAt: new Date() },
    });
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
        submissions: {
          none: { status: { not: SubmissionStatus.IN_PROGRESS } },
        },
      },
    });
    if (count === 0)
      throw new ForbiddenException(
        'По заказу уже сдавали видео — удалить его нельзя, только закрыть',
      );
    return order;
  }

  /**
   * Публикация. Срок в форме — «N дней», а считался от создания: сдвигаем его на время модерации,
   * чтобы у креаторов было ровно N дней с момента публикации.
   */
  async moderatorApprove(orderId: number, moderatorTelegramId: bigint) {
    const order = await this.mustFind(orderId);
    const now = new Date();
    await this.transitionStatus(orderId, [OrderStatus.PENDING_MODERATION], {
      status: OrderStatus.OPEN,
      moderatorId: moderatorTelegramId,
      decidedAt: now,
      deadline: order.deadline
        ? new Date(
            order.deadline.getTime() +
              (now.getTime() - order.createdAt.getTime()),
          )
        : null,
    });
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { advertiser: true },
    });
  }

  async moderatorReject(
    orderId: number,
    moderatorTelegramId: bigint,
    comment: string,
  ) {
    await this.transitionStatus(orderId, [OrderStatus.PENDING_MODERATION], {
      status: OrderStatus.REJECTED,
      moderatorId: moderatorTelegramId,
      moderatorComment: comment,
      decidedAt: new Date(),
    });
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { advertiser: true },
    });
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

  private async mustFind(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  /**
   * Атомарно применяет переход статуса, обусловленный текущим статусом — поэтому два
   * одновременных действия над одним заказом (двойной тап, или гонка двух модераторов
   * над одним пунктом очереди) не могут оба пройти: первый `updateMany` находит строку,
   * второй видит `count === 0` и сообщает о конфликте вместо перезаписи.
   */
  private async transitionStatus(
    orderId: number,
    fromStatuses: OrderStatus[],
    data: Prisma.OrderUpdateManyMutationInput,
    conflictMessage = 'Этот заказ уже обработан',
  ) {
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      await this.mustFind(orderId);
      throw new ForbiddenException(conflictMessage);
    }
  }
}
