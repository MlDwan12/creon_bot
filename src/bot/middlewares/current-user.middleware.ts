import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '../interfaces/bot-context.interface';
import { setCurrentUser } from '../interfaces/bot-context.interface';
import type { UsersService } from '../../users/users.service';

export function currentUserMiddleware(
  usersService: UsersService,
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from) return next();
    const user = await usersService.findOrCreate({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    setCurrentUser(ctx, user);
    return next();
  };
}
