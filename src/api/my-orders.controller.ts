import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, SubmissionStatus } from '@prisma/client';
import { kopecksToRubles } from '../common/money';
import { NotificationsService } from '../bot/notifications.service';
import { creatorLabel } from '../bot/utils/format';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { attemptNumbers } from './attempts';
import {
  type ApiRequest,
  InitDataGuard,
  requireUsername,
} from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { parseDeadlineDays, parseOrderInput } from './order-input';

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
    return orders.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      price: kopecksToRubles(o.priceKopecks),
      category: o.category,
      deadline: o.deadline,
      status: o.status,
      rejectReason:
        o.status === OrderStatus.REJECTED ? o.moderatorComment : null,
      submissionsCount: o.submissions.length,
      // Та же проверка, что в OrdersService.remove.
      deletable: o.submissions.every(
        (s) => s.status === SubmissionStatus.IN_PROGRESS,
      ),
      pendingDecision: o.submissions.filter(
        (s) => s.status === SubmissionStatus.MODERATOR_APPROVED,
      ).length,
      createdAt: o.createdAt,
    }));
  }

  /** Новый заказ → на модерацию, модераторам уведомление. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    requireUsername(req.user);
    const order = await this.ordersService.create(
      req.user.id,
      parseOrderInput(body),
    );
    await this.notifications.orderCreated(order);
    return { id: order.id };
  }

  @Post(':id/close')
  async close(@Param('id', ParseIntPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ordersService.close(id, req.user.id);
    await this.notifications.orderClosed(order);
    return { ok: true };
  }

  /** Продлить срок на `days` дней; заказ с истёкшим сроком снова открывается. */
  @Post(':id/extend')
  async extend(
    @Param('id', ParseIntPipe) id: number,
    @Body('days') days: unknown,
    @Req() req: ApiRequest,
  ) {
    await this.ordersService.extend(id, req.user.id, parseDeadlineDays(days));
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ordersService.remove(id, req.user.id);
    await this.notifications.orderRemoved(order);
    return { ok: true };
  }

  /** Видео по моему заказу, одобренные модератором и ждущие моего решения. */
  @Get(':id/pending-videos')
  async pendingVideos(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const order = await this.ordersService.findById(id);
    if (!order || order.advertiserId !== req.user.id) {
      throw new NotFoundException('Заказ не найден');
    }
    const all = await this.submissionsService.listByOrder(id);
    const attempts = attemptNumbers(all);
    return {
      order: { id: order.id, title: order.title },
      items: all
        .filter((s) => s.status === SubmissionStatus.MODERATOR_APPROVED)
        .reverse() // старые — первыми: кто раньше прислал, того раньше и смотрим
        .map((s) => ({
          id: s.id,
          videoUrl: s.videoUrl,
          creator: creatorLabel(s.creator),
          creatorId: s.creatorId,
          attempt: attempts.get(s.id)!,
          submittedAt: s.submittedAt,
        })),
    };
  }
}
