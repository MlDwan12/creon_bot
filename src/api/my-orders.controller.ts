import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';
import { OrderStatus, SubmissionStatus } from '@prisma/client';
import { kopecksToRubles } from '../common/money';
import { HOLDS_MONEY, payoutPool } from '../orders/budget';
import { NotificationsService } from '../bot/notifications.service';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { buildOrderReport, reportCsv } from './order-report';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
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
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Req() req: ApiRequest) {
    const orders = await this.ordersService.listByAdvertiser(req.user.id);
    // Поля явно: без модераторского id (BigInt) и без чужих данных из откликов.
    return orders.map((o) => {
      const approved = o.submissions.filter(
        (s) => s.status === SubmissionStatus.MODERATOR_APPROVED,
      );
      // резерв роликов на проверке тоже занимает фонд — как в src/orders/budget.ts
      const spent = o.submissions
        .filter((s) => HOLDS_MONEY.includes(s.status))
        .reduce((sum, s) => sum + s.payoutMinor, 0);
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        referenceUrl: o.referenceUrl,
        ...videoFormat(o),
        budget: kopecksToRubles(o.budgetMinor),
        minViews: o.minViews,
        category: o.category,
        deadline: o.deadline,
        status: o.status,
        rejectReason:
          o.status === OrderStatus.REJECTED ? o.moderatorComment : null,
        // Фонд креаторам — бюджет без комиссии; рекламодателю — доля израсходованного бюджета.
        usedPercent: Math.min(
          100,
          Math.round((spent / Math.max(1, payoutPool(o))) * 100),
        ),
        approved: approved.length,
        views: approved.reduce((sum, s) => sum + (s.views ?? 0), 0),
        toRate: approved.filter((s) => s.rating === null).length,
        submissionsCount: o.submissions.length,
        // Та же проверка, что в OrdersService.remove.
        deletable: o.submissions.every(
          (s) => s.status === SubmissionStatus.IN_PROGRESS,
        ),
        createdAt: o.createdAt,
      };
    });
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
    const order = await this.ordersService.update(
      id,
      req.user.id,
      parseOrderEdit(body),
    );
    this.notifications.orderEdited(order);
    return { ok: true };
  }

  @Post(':id/close')
  async close(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ordersService.close(id, req.user.id);
    this.notifications.orderClosed(order);
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

  /** Отчёт по моему заказу: сводка, площадки, одобренные ролики (оценка — по желанию). */
  @Get(':id/report')
  async report(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    return buildOrderReport(
      await this.ownOrder(id, req.user.id),
      await this.submissionsService.listByOrder(id),
    );
  }

  /** Тот же отчёт файлом CSV — в чат с ботом: скачивание файлов из мини-аппа работает не везде. */
  @Post(':id/report/csv')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async reportFile(
    @Param('id', ParseIdPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const report = buildOrderReport(
      await this.ownOrder(id, req.user.id),
      await this.submissionsService.listByOrder(id),
    );
    const sent = await this.notifications.sendFile(
      req.user.telegramId,
      reportCsv(report),
      `creon-order-${id}.csv`,
    );
    if (!sent)
      throw new BadRequestException(
        'Не удалось отправить файл — откройте чат с ботом и нажмите «Старт»',
      );
    return { ok: true };
  }

  private async ownOrder(id: number, advertiserId: number) {
    const order = await this.ordersService.findById(id);
    if (!order || order.advertiserId !== advertiserId)
      throw new NotFoundException('Заказ не найден');
    return order;
  }
}
