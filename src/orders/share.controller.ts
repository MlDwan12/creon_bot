import { tr } from '../i18n/request-lang';
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { publicReport } from './order-report';
import { OrdersService } from './orders.service';

/**
 * Публичный отчёт по ссылке <WEB_URL>/share/<токен> — без входа: заказчик пересылает результат
 * руководителю. Отозванная или чужая ссылка — 404.
 * ponytail: без лимита по IP — за nginx у всех один IP (как у /r/); токен в 128 бит не перебрать,
 * а частоту на входе держит limit_req nginx.
 */
@Controller('api/share')
export class ShareController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const order = /^[\w-]{22}$/.test(token)
      ? await this.ordersService.findByShareToken(token)
      : null;
    if (!order) throw new NotFoundException(tr('errors.shareGone'));
    return publicReport(await this.ordersService.report(order));
  }
}
