import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
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
    if (!url) throw new NotFoundException('Ссылка не найдена');
    res.redirect(302, url);
  }
}
