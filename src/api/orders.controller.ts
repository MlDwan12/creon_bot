import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';
import { OrderCategory } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { kopecksToRubles } from '../common/money';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { type ApiRequest, InitDataGuard } from './init-data.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { videoFormat } from './order-input';

const PAGE_SIZE = 20;

/**
 * Креатору — ставка и свободный остаток фонда выплат в рублях. Бюджет рекламодателя и комиссию
 * площадки не показываем.
 */
function toPublic(
  order: Awaited<ReturnType<OrdersService['listOpen']>>['items'][number],
) {
  return {
    id: order.id,
    title: order.title,
    description: order.description,
    referenceUrl: order.referenceUrl,
    ...videoFormat(order),
    minViews: order.minViews,
    cpm: kopecksToRubles(order.cpmMinor),
    free: kopecksToRubles(order.freeMinor),
    category: order.category,
    deadline: order.deadline,
    createdAt: order.createdAt,
  };
}

@Controller('api/orders')
@UseGuards(InitDataGuard, UserThrottlerGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  /**
   * Каталог открытых заказов для креатора. Следующая страница — `afterId` и `afterCreatedAt`
   * последнего показанного заказа; без них — первая.
   */
  @Get()
  async listOpen(
    @Query('category', new ParseEnumPipe(OrderCategory, { optional: true }))
    category: OrderCategory | undefined,
    @Query('afterId', new ParseIntPipe({ optional: true })) afterId?: number,
    @Query('afterCreatedAt') afterCreatedAt?: string,
  ) {
    let after: { createdAt: Date; id: number } | undefined;
    if (afterId !== undefined) {
      const createdAt = new Date(afterCreatedAt ?? '');
      if (Number.isNaN(createdAt.getTime()))
        throw new BadRequestException('Некорректная страница');
      after = { createdAt, id: afterId };
    }
    const { items, hasMore, total } = await this.ordersService.listOpen(
      category,
      after,
      PAGE_SIZE,
    );
    return { items: items.map(toPublic), hasMore, total };
  }

  /** Карточка открытого заказа; `claimed` — есть ли у текущего пользователя отклик «в работе», `own` — заказ его. */
  @Get(':id')
  async findOpen(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ordersService.findOpenById(id);
    if (!order) throw new NotFoundException('Заказ не найден или уже закрыт');
    const claimed = await this.submissionsService.hasInProgress(
      id,
      req.user.id,
    );
    const { advertiserId, ...pub } = order;
    return {
      ...toPublic(pub),
      claimed,
      own: advertiserId === req.user.id,
    };
  }

  /** Отклик на заказ (дубли, гонки и отклик на свой заказ отсекает сервис). */
  @Post(':id/claim')
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  @HttpCode(201)
  async claim(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const submission = await this.submissionsService.claim(id, req.user.id);
    return { submissionId: submission.id };
  }
}
