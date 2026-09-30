import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';

/**
 * Основное фото профиля Telegram. Отдаём байты, а не ссылку: в ссылке на файл Bot API
 * зашит токен бота. Telegram сам учитывает настройки приватности человека — если фото
 * скрыто от бота (или человек не запускал бота), фото просто нет.
 */
@Injectable()
export class TelegramPhotosService {
  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  /** JPEG ~320px или `null`, если фото нет или Telegram его не отдал. */
  async profilePhoto(telegramId: bigint): Promise<Buffer | null> {
    try {
      const { photos } = await this.bot.telegram.getUserProfilePhotos(
        Number(telegramId),
        0,
        1,
      );
      const sizes = photos[0];
      if (!sizes?.length) return null;
      // размеры идут по возрастанию: 160, 320, 640 — для аватара хватает среднего
      const size = sizes[1] ?? sizes[0];
      const link = await this.bot.telegram.getFileLink(size.file_id);
      // без таймаута медленный ответ Telegram держал бы запрос к API сколько угодно
      const res = await fetch(link, { signal: AbortSignal.timeout(5000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}
