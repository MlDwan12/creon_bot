import type { ConfigService } from '@nestjs/config';
import type { Context, MiddlewareFn } from 'telegraf';
import { langFromTelegram, translator } from '../i18n/i18n';
import { parseModeratorIds } from './moderator.util';

/**
 * Дев-стенд — только для своих: DEV_ALLOWED_IDS (Telegram id через запятую) плюс модераторы.
 * Не задан — пускаем всех: так на проде. Закрывает всё сразу — бот (devGate), API мини-аппа и
 * сайта (InitDataGuard) и вход на сайт через Telegram (WebAuthController).
 */
export function devAllowList(config: ConfigService): Set<string> | null {
  const extra = parseModeratorIds(config.get<string>('DEV_ALLOWED_IDS'));
  if (!extra.size) return null;
  return new Set([
    ...extra,
    ...parseModeratorIds(config.get<string>('MODERATOR_IDS')),
  ]);
}

export function devAllowed(
  list: Set<string> | null,
  telegramId: bigint | number | string,
) {
  return !list || list.has(String(telegramId));
}

/**
 * Бот на закрытом стенде: чужим в личке — «тестовый стенд», остальное от них молча пропускаем.
 * Группа поддержки (SUPPORT_CHAT_ID) — всегда: там отвечают свои.
 */
export function devGate(config: ConfigService): MiddlewareFn<Context> {
  const list = devAllowList(config);
  const supportChat = config.get<string>('SUPPORT_CHAT_ID') || null;
  return async (ctx, next) => {
    const from = ctx.from;
    if (
      !list ||
      !from ||
      String(ctx.chat?.id) === supportChat ||
      devAllowed(list, from.id)
    )
      return next();
    if (ctx.chat?.type === 'private' && ctx.message)
      await ctx.reply(
        translator(langFromTelegram(from.language_code))('bot.devClosed'),
      );
  };
}
