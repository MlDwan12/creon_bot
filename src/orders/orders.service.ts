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
    return { items: rows.slice(0, take), hasMore: rows.length > take, total };
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
  findOpenById(id: number) {
    return this.prisma.order.findFirst({
      where: { id, status: OrderStatus.OPEN },
      select: { ...PUBLIC_ORDER_FIELDS, advertiserId: true },
    });
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
      priceKopecks: number | null;
      category: OrderCategory;
      deadline?: Date | null;
    },
  ) {
    const order = await this.mustFind(orderId);
    if (order.advertiserId !== advertiserId)
      throw new ForbiddenException('Это не ваш заказ');
    // Цена — то, за что креаторы уже сняли видео: пока есть сданные работы, её не меняем.
    if (data.priceKopecks !== order.priceKopecks) {
      const delivered = await this.prisma.submission.count({
        where: {
          orderId,
          status: {
            in: [
              SubmissionStatus.SUBMITTED,
              SubmissionStatus.MODERATOR_APPROVED,
            ],
          },
        },
      });
      if (delivered)
        throw new ForbiddenException(
          'Цену нельзя менять, пока есть видео на проверке — сначала примите или отклоните их',
        );
    }
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
    await this.transitionStatus(
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
      // повтор проверки цены в самом updateMany: видео могли сдать между подсчётом выше и записью
      data.priceKopecks === order.priceKopecks
        ? undefined
        : {
            submissions: {
              none: {
                status: {
                  in: [
                    SubmissionStatus.SUBMITTED,
                    SubmissionStatus.MODERATOR_APPROVED,
                  ],
                },
              },
            },
          },
    );
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
   */
  async moderatorApprove(
    orderId: number,
    moderatorTelegramId: bigint,
    version: Date,
  ) {
    const order = await this.mustFind(orderId);
    const now = new Date();
    await this.transitionStatus(
      orderId,
      [OrderStatus.PENDING_MODERATION],
      {
        status: OrderStatus.OPEN,
        moderatorId: moderatorTelegramId,
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
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { advertiser: true },
    });
  }

  /**
   * Возвращает заказ с креаторами в работе: отклонить можно и изменённый открытый заказ —
   * тогда им надо сказать, что работа по нему больше не нужна.
   */
  async moderatorReject(
    orderId: number,
    moderatorTelegramId: bigint,
    comment: string,
    version: Date,
  ) {
    await this.transitionStatus(
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
    const order = await this.withActiveCreators(orderId);
    // Изменённый открытый заказ сняли — видео по нему не ждут ни модератора, ни рекламодателя.
    await this.prisma.submission.updateMany({
      where: {
        orderId,
        status: {
          in: [SubmissionStatus.SUBMITTED, SubmissionStatus.MODERATOR_APPROVED],
        },
      },
      data: {
        status: SubmissionStatus.MODERATOR_REJECTED,
        moderatorComment: 'Заказ снят модератором',
        decidedAt: new Date(),
      },
    });
    return order;
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
    /** Доп. условие в том же запросе — например, версия, которую видел модератор. */
    also?: Prisma.OrderWhereInput,
  ) {
    const result = await this.prisma.order.updateMany({
      where: { ...also, id: orderId, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      await this.mustFind(orderId);
      throw new ForbiddenException(conflictMessage);
    }
  }
}
