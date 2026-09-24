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
import { NotificationsService } from '../bot/notifications.service';
import { creatorLabel } from '../bot/utils/format';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { parseOrderInput } from './order-input';

/** Заказы текущего пользователя как рекламодателя. Права проверяют сервисы — как в боте. */
@Controller('api/my-orders')
@UseGuards(InitDataGuard)
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
      price: o.price,
      category: o.category,
      deadline: o.deadline,
      status: o.status,
      rejectReason:
        o.status === OrderStatus.REJECTED ? o.moderatorComment : null,
      submissionsCount: o.submissions.length,
      pendingDecision: o.submissions.filter(
        (s) => s.status === SubmissionStatus.MODERATOR_APPROVED,
      ).length,
      createdAt: o.createdAt,
    }));
  }

  /** Новый заказ → на модерацию, модераторам уведомление — как после формы в боте. */
  @Post()
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
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
    // Номер попытки креатора по этому заказу: listByOrder — от новых к старым, считаем со старых.
    const perCreator = new Map<number, number>();
    const attemptOf = new Map<number, number>();
    for (const s of [...all].reverse()) {
      const n = (perCreator.get(s.creatorId) ?? 0) + 1;
      perCreator.set(s.creatorId, n);
      attemptOf.set(s.id, n);
    }
    return {
      order: { id: order.id, title: order.title },
      items: all
        .filter((s) => s.status === SubmissionStatus.MODERATOR_APPROVED)
        .reverse() // старые — первыми: кто раньше прислал, того раньше и смотрим
        .map((s) => ({
          id: s.id,
          videoUrl: s.videoUrl,
          creator: creatorLabel(s.creator),
          attempt: attemptOf.get(s.id)!,
          submittedAt: s.submittedAt,
        })),
    };
  }
}
