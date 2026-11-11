import { statsCsv } from './advertiser-stats';
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
  ParseIntPipe,
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
import { DAY_MS } from './deadline';
import { NotificationsService } from '../telegram/notifications.service';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { randomBytes } from 'node:crypto';
import { canShare, reportCsv, shareLink } from './order-report';
import { type ApiRequest, InitDataGuard } from '../auth/init-data.guard';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { AdvertiserGuard } from '../auth/advertiser.guard';
import {
  parseDeadlineDays,
  parseOrderEdit,
  parseOrderInput,
  videoFormat,
} from './order-input';

/**
 * Заказы текущего пользователя как рекламодателя. Права на заказ проверяют сервисы; создать, править
 * и продлить — только с открытым кабинетом (AdvertiserGuard). Закрытый кабинет — смотреть свои
 * заказы, закрыть или удалить их, оценить ролики.
 */
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
      requirements: o.requirements,
      referenceUrl: o.referenceUrl,
      targetUrl: o.targetUrl,
      linkInBio: o.linkInBio,
      ...videoFormat(o),
      budget: fromMinor(o.budgetMinor),
      minViews: o.minViews,
      maxPayout: fromMinor(o.maxPayoutMinor),
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
   * Статистика по всем моим заказам за `days` дней (7 или 30; без параметра — всё время): сводка,
   * прирост просмотров по дням, заказы, площадки и 10 лучших роликов. Смотреть — и с закрытым кабинетом.
   */
  @Get('stats')
  async stats(
    @Query('days', new ParseIntPipe({ optional: true })) days: unknown,
    @Req() req: ApiRequest,
  ) {
    const { videos, ...stats } = await this.ordersService.advertiserStats(
      req.user.id,
      statsSince(days),
    );
    return { ...stats, top: videos.slice(0, 10) };
  }

  /** Все ролики периода файлом CSV — в чат с ботом, как отчёт заказа. */
  @Post('stats/csv')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async statsFile(
    @Query('days', new ParseIntPipe({ optional: true })) days: unknown,
    @Req() req: ApiRequest,
  ) {
    const stats = await this.ordersService.advertiserStats(
      req.user.id,
      statsSince(days),
    );
    const sent = await this.notifications.sendFile(
      req.user.telegramId,
      statsCsv(stats),
      'fixum-stats.csv',
    );
    if (!sent) throw new BadRequestException(tr('errors.fileNotSent'));
    return { ok: true };
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
  @UseGuards(AdvertiserGuard)
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
  @UseGuards(AdvertiserGuard)
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
  @UseGuards(AdvertiserGuard)
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
    const order = await this.ownOrder(id, req.user.id);
    return {
      ...(await this.ordersService.report(order)),
      // публичная ссылка на отчёт (null — нет); canShare — известен адрес сайта, где он откроется
      share: { url: shareLink(order.shareToken), available: canShare() },
    };
  }

  /**
   * Ссылка на отчёт для тех, у кого нет входа (руководитель): новый токен — прежняя ссылка
   * перестаёт работать. Публикует данные заказа — только с открытым кабинетом.
   */
  @Post(':id/report/share')
  @UseGuards(AdvertiserGuard)
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  async share(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ownOrder(id, req.user.id);
    if (!canShare()) throw new BadRequestException(tr('errors.shareOff'));
    // 16 байт — 22 символа base64url: перебором не подобрать
    const token = randomBytes(16).toString('base64url');
    await this.ordersService.setShareToken(order.id, token);
    return { url: shareLink(token) };
  }

  /** Отозвать ссылку на отчёт — можно и с закрытым кабинетом. */
  @Delete(':id/report/share')
  async unshare(@Param('id', ParseIdPipe) id: number, @Req() req: ApiRequest) {
    const order = await this.ownOrder(id, req.user.id);
    await this.ordersService.setShareToken(order.id, null);
    return { ok: true };
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

/** Начало периода статистики: 7 или 30 дней назад; без параметра — всё время. */
function statsSince(days: unknown) {
  if (days === undefined) return undefined;
  if (days !== 7 && days !== 30)
    throw new BadRequestException('days — 7 или 30');
  return new Date(Date.now() - days * DAY_MS);
}
