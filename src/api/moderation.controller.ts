import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from '../bot/notifications.service';
import { creatorLabel } from '../bot/utils/format';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { attemptNumbers } from './attempts';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { ModeratorGuard } from './moderator.guard';
import { parseRejectComment } from './order-input';

const PAGE_SIZE = 20;

/**
 * Окно модератора в Mini App. Гонки двух модераторов над одним пунктом отсекает transitionStatus.
 */
@Controller('api/mod')
@UseGuards(InitDataGuard, ModeratorGuard)
export class ModerationController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Обе очереди сразу: заказы и видео на проверке, старые первыми. */
  @Get('queue')
  async queue() {
    const [orders, videos] = await Promise.all([
      this.ordersService.listPending(),
      this.submissionsService.listPendingModeration(),
    ]);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        title: o.title,
        price: o.price,
        advertiser: creatorLabel(o.advertiser),
        createdAt: o.createdAt,
      })),
      videos: videos.map((s) => ({
        id: s.id,
        orderTitle: s.order.title,
        creator: creatorLabel(s.creator),
        submittedAt: s.submittedAt,
      })),
    };
  }

  @Get('stats')
  async stats() {
    const [orders, submissions] = await Promise.all([
      this.ordersService.stats(),
      this.submissionsService.stats(),
    ]);
    return { orders, submissions };
  }

  /** Все заказы любого статуса — страница, новые первыми. */
  @Get('orders')
  async allOrders(
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
  ) {
    const { items, total } = await this.ordersService.listAll(
      Math.max(0, page) * PAGE_SIZE,
      PAGE_SIZE,
    );
    return {
      items: items.map((o) => ({
        id: o.id,
        title: o.title,
        price: o.price,
        status: o.status,
        advertiser: creatorLabel(o.advertiser),
        submissionsCount: o._count.submissions,
        createdAt: o.createdAt,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  @Get('orders/:id')
  async order(@Param('id', ParseIntPipe) id: number) {
    const o = await this.ordersService.findWithAdvertiser(id);
    if (!o) throw new NotFoundException('Заказ не найден');
    return {
      id: o.id,
      title: o.title,
      description: o.description,
      price: o.price,
      category: o.category,
      deadline: o.deadline,
      status: o.status,
      moderatorComment: o.moderatorComment,
      advertiser: creatorLabel(o.advertiser),
      createdAt: o.createdAt,
    };
  }

  @Post('orders/:id/approve')
  async approveOrder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const order = await this.ordersService.moderatorApprove(
      id,
      req.user.telegramId,
    );
    await this.notifications.orderApproved(order);
    return { ok: true };
  }

  @Post('orders/:id/reject')
  async rejectOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    const order = await this.ordersService.moderatorReject(
      id,
      req.user.telegramId,
      comment,
    );
    await this.notifications.orderRejected(order, comment);
    return { ok: true };
  }

  @Get('videos/:id')
  async video(@Param('id', ParseIntPipe) id: number) {
    const s = await this.submissionsService.findById(id);
    if (!s) throw new NotFoundException('Отклик не найден');
    const attempts = attemptNumbers(
      await this.submissionsService.listByOrder(s.orderId),
    );
    return {
      id: s.id,
      status: s.status,
      videoUrl: s.videoUrl,
      submittedAt: s.submittedAt,
      creator: creatorLabel(s.creator),
      attempt: attempts.get(s.id)!,
      order: {
        id: s.order.id,
        title: s.order.title,
        description: s.order.description,
      },
    };
  }

  @Post('videos/:id/approve')
  async approveVideo(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const submission = await this.submissionsService.moderatorApprove(
      id,
      req.user.telegramId,
    );
    await this.notifications.videoApprovedByModerator(submission);
    return { ok: true };
  }

  @Post('videos/:id/reject')
  async rejectVideo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    const comment = parseRejectComment(body);
    const submission = await this.submissionsService.moderatorReject(
      id,
      req.user.telegramId,
      comment,
    );
    await this.notifications.videoRejectedByModerator(submission, comment);
    return { ok: true };
  }
}
