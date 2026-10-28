import { tr } from '../i18n/request-lang';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubmissionsService } from './submissions.service';

/**
 * Ссылка креатора на товар: /r/<код> → страница товара, переход засчитывается креатору.
 * Без авторизации — по ней переходят зрители ролика.
 * ponytail: без ограничения частоты — за nginx у всех один IP (trust proxy не включён), лимит по IP
 * задел бы всех зрителей разом; запрос — один UPDATE по уникальному индексу.
 */
@Controller('r')
export class TrackController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get(':code')
  async go(@Param('code') code: string, @Res() res: Response) {
    const url = /^[\w-]{1,32}$/.test(code)
      ? await this.submissionsService.click(code)
      : null;
    if (!url) throw new NotFoundException(tr('errors.linkNotFound'));
    res.redirect(302, url);
  }
}

/**
 * Ссылка на ролик в отчёте рекламодателя: /v/<код> → ролик на площадке. Ссылку площадки с ником
 * креатора рекламодатель не видит (videoLinkForAdvertiser). Без авторизации — открывается в браузере.
 */
@Controller('v')
export class VideoLinkController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /** Пример ролика из заказа: /v/e/<заказ>/<номер с 1> (exampleLink). */
  @Get('e/:orderId/:n')
  async example(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('n', ParseIntPipe) n: number,
    @Res() res: Response,
  ) {
    const url = await this.submissionsService.exampleUrl(orderId, n);
    if (!url) throw new NotFoundException(tr('errors.linkNotFound'));
    res.redirect(302, url);
  }

  @Get(':code')
  async go(@Param('code') code: string, @Res() res: Response) {
    const url = /^[\w-]{1,32}$/.test(code)
      ? await this.submissionsService.videoByCode(code)
      : null;
    if (!url) throw new NotFoundException(tr('errors.linkNotFound'));
    res.redirect(302, url);
  }
}
