import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseEnumPipe,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderCategory } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { InitDataGuard } from './init-data.guard';

const PAGE_SIZE = 20;

@Controller('api/orders')
@UseGuards(InitDataGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
}
