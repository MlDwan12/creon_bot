import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';

/**
 * Продажа на сайте рекламодателя: GET /api/conversions?code=<код креатора>&id=<номер заказа>.
 * Шлёт пиксель со страницы «спасибо» (картинкой — без CORS) или сервер рекламодателя (постбэк).
 * Без авторизации. Ответ всегда 204: снаружи не узнать, существует ли код.
 */
@Controller('api/conversions')
export class ConversionController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @HttpCode(204)
  async track(@Query('code') code: unknown, @Query('id') id: unknown) {
    if (typeof code !== 'string' || !/^[\w-]{1,32}$/.test(code)) return;
    const externalId =
      typeof id === 'string' && id.trim() ? id.trim().slice(0, 100) : null;
    await this.submissionsService.convert(code, externalId);
  }
}
