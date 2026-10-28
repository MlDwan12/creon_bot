import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  ParseEnumPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { OrderCategory, OrderStatus } from '@prisma/client';
import { isFrozen } from './order-status';
import { fromMinor } from '../common/money';
import { payoutPool } from './budget';
import { NotificationsService } from '../telegram/notifications.service';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { reportCsv } from './order-report';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import {
  parseDeadlineDays,
  parseOrderEdit,
  parseOrderInput,
  videoFormat,
} from './order-input';

/** Заказы текущего пользователя как рекламодателя. Права проверяют сервисы. */
@Controller('api/my-orders')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class MyOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Req() req: ApiRequest) {
    const orders = await this.ordersService.listByAdvertiser(req.user.id);
    // Поля явно: без модераторского id (BigInt) и без чужих данных из откликов.
    return orders.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      exampleUrls: o.exampleUrls,
      referenceUrl: o.referenceUrl,
      targetUrl: o.targetUrl,
      linkInBio: o.linkInBio,
      ...videoFormat(o),
      budget: fromMinor(o.budgetMinor),
      minViews: o.minViews,
      category: o.category,
      deadline: o.deadline,
      status: o.status,
      rejectReason:
        o.status === OrderStatus.REJECTED ||
        o.status === OrderStatus.EDIT_REJECTED
          ? o.moderatorComment
          : null,
      // правку опубликованного заказа не одобрили — ролики не сдают, можно исправить или закрыть
      frozen: isFrozen(o),
      // весь фонд зарезервирован под ролики на проверке — новые не принимаются, пока их не проверят
      fundBusy: o.fundBusyAt !== null,
      // Фонд креаторам — бюджет без комиссии; рекламодателю — доля израсходованного бюджета.
      usedPercent: Math.min(
        100,
        Math.round((o.stats.spentMinor / Math.max(1, payoutPool(o))) * 100),
      ),
      approved: o.stats.approved,
      views: o.stats.views,
      toRate: o.stats.toRate,
      submissionsCount: o.stats.submissions,
      deletable: o.stats.deletable,
      createdAt: o.createdAt,
    }));
  }

  /**
   * Подсказка в форме заказа: сколько обычно стоят 1000 просмотров в категории, USDT; null — мало
   * данных. Ставку по-прежнему назначает модератор — это ориентир, сколько просмотров даст бюджет.
   */
  @Get('price-hint')
  async priceHint(
    @Query('category', new ParseEnumPipe(OrderCategory))
    category: OrderCategory,
  ) {
    return {
      per1000: fromMinor(await this.ordersService.typicalPrice(category)),
    };
  }

  /** Новый заказ → на модерацию, модераторам уведомление. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const order = await this.ordersService.create(
      req.user.id,
      parseOrderInput(body),
    );
    this.notifications.orderCreated(order);
    return { id: order.id };
  }

  /** Правка заказа: снова на проверку; креаторам, уже работающим по открытому заказу, — уведомление. */
  @Put(':id')
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  async update(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const { notify, ...order } = await this.ordersService.update(
      id,
      req.user.id,
      parseOrderEdit(body),
    );
    this.notifications.orderEdited(order, notify);
    return { ok: true };
  }

  @Post(':id/close')
  async close(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const { burned, ...order } = await this.ordersService.close(
      id,
      req.user.id,
    );
    const burnedIds = new Set(burned.map((s) => s.id));
    this.notifications.orderClosed({
      ...order,
      submissions: order.submissions.filter((s) => !burnedIds.has(s.id)),
    });
    if (burned.length)
      this.notifications.orderClosedSlotsBurned({
        ...order,
        submissions: burned,
      });
    return { ok: true };
  }

  /** Продлить срок на `days` дней; заказ с истёкшим сроком снова открывается. */
  @Post(':id/extend')
  async extend(
    @Param('id', ParseIdPipe) id: number,
    @Body('days') days: unknown,
    @Req() req: ApiRequest,
  ) {
    await this.ordersService.extend(id, req.user.id, parseDeadlineDays(days));
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ordersService.remove(id, req.user.id);
    this.notifications.orderRemoved(order);
    return { ok: true };
  }

  /** Отчёт по моему заказу: сводка, площадки, одобренные ролики, воронка и советы. */
  @Get(':id/report')
  async report(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    return this.ordersService.report(await this.ownOrder(id, req.user.id));
  }

  /** Тот же отчёт файлом CSV — в чат с ботом: скачивание файлов из мини-аппа работает не везде. */
  @Post(':id/report/csv')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async reportFile(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const report = await this.ordersService.report(
      await this.ownOrder(id, req.user.id),
    );
    const sent = await this.notifications.sendFile(
      req.user.telegramId,
      reportCsv(report),
      `fixum-order-${id}.csv`,
    );
    if (!sent) throw new BadRequestException(tr('errors.fileNotSent'));
    return { ok: true };
  }

  private async ownOrder(id: number, advertiserId: number) {
    const order = await this.ordersService.findById(id);
    if (!order || order.advertiserId !== advertiserId)
      throw new NotFoundException(tr('errors.orderNotFound'));
    return order;
  }
}
