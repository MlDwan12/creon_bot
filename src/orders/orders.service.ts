import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderCategory, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    advertiserId: number,
    data: {
      title: string;
      description: string;
      price?: string;
      category: OrderCategory;
      deadline?: Date;
    },
  ) {
    return this.prisma.order.create({
      data: {
        advertiserId,
        title: data.title,
        description: data.description,
        price: data.price,
        category: data.category,
        deadline: data.deadline,
      },
      include: { advertiser: true },
    });
  }

  /** Fetches a single open order by its position in the browse order, for a one-card-at-a-time carousel. Optionally filtered to one category. */
  async getOpenAt(index: number, category?: OrderCategory) {
    const where = {
      status: OrderStatus.OPEN,
      ...(category ? { category } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: index,
        take: 1,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { order: items[0], total };
  }

  /** Fetches a single order (any status) by its position, for the moderator's "all orders" carousel. */
  async getAllAt(index: number) {
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { advertiser: true, submissions: true },
        skip: index,
        take: 1,
      }),
      this.prisma.order.count(),
    ]);
    return { order: items[0], total };
  }

  /** Fetches a single pending order by its position, for the moderator's review carousel. */
  async getPendingAt(index: number) {
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: OrderStatus.PENDING_MODERATION },
        orderBy: { createdAt: 'asc' },
        include: { advertiser: true },
        skip: index,
        take: 1,
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.PENDING_MODERATION },
      }),
    ]);
    return { order: items[0], total };
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

  /** Deletes an order outright (auto-closing it first if still open). Submissions cascade-delete with it. */
  async remove(orderId: number, advertiserId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { submissions: { include: { creator: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    await this.prisma.order.delete({ where: { id: orderId } });
    return order;
  }

  async moderatorApprove(orderId: number, moderatorTelegramId: bigint) {
    await this.transitionStatus(orderId, [OrderStatus.PENDING_MODERATION], {
      status: OrderStatus.OPEN,
      moderatorId: moderatorTelegramId,
      decidedAt: new Date(),
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
      this.prisma.order.count({ where: { status: OrderStatus.CLOSED } }),
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
