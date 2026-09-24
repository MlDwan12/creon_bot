import {
  Controller,
  DefaultValuePipe,
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
import { OrderCategory } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { SubmissionsService } from '../submissions/submissions.service';
import {
  type ApiRequest,
  InitDataGuard,
  requireUsername,
} from './init-data.guard';

const PAGE_SIZE = 20;

@Controller('api/orders')
@UseGuards(InitDataGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  /** Каталог открытых заказов для креатора. `page` с нуля. */
  @Get()
  async listOpen(
    @Query('category', new ParseEnumPipe(OrderCategory, { optional: true }))
    category: OrderCategory | undefined,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
  ) {
    const { items, total } = await this.ordersService.listOpen(
      category,
      Math.max(0, page) * PAGE_SIZE,
      PAGE_SIZE,
    );
    return { items, total, page, pageSize: PAGE_SIZE };
  }

  /** Карточка открытого заказа; `claimed` — есть ли у текущего пользователя отклик «в работе», `own` — заказ его. */
  @Get(':id')
  async findOpen(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ApiRequest,
  ) {
    const order = await this.ordersService.findOpenById(id);
    if (!order) throw new NotFoundException('Заказ не найден или уже закрыт');
    const claimed = await this.submissionsService.hasInProgress(
      id,
      req.user.id,
    );
    const { advertiserId, ...pub } = order;
    return { ...pub, claimed, own: advertiserId === req.user.id };
  }

  /** Отклик на заказ (дубли, гонки и отклик на свой заказ отсекает сервис). */
  @Post(':id/claim')
  @HttpCode(201)
  async claim(@Param('id', ParseIntPipe) id: number, @Req() req: ApiRequest) {
    requireUsername(req.user);
    const submission = await this.submissionsService.claim(id, req.user.id);
    return { submissionId: submission.id };
  }
}
