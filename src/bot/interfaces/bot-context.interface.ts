import { Scenes } from 'telegraf';
import type { User } from '@prisma/client';

export type BotContext = Scenes.WizardContext;

export function getCurrentUser(ctx: BotContext): User {
  return (ctx.state as Record<string, unknown>).user as User;
}

export function setCurrentUser(ctx: BotContext, user: User): void {
  (ctx.state as Record<string, unknown>).user = user;
}
