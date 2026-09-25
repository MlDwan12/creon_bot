import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface TelegramUserInput {
  telegramId: bigint;
  username?: string;
  firstName?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Вызывается на каждый запрос к API (InitDataGuard), поэтому сначала читаем: пишем в базу, только
   * если человек новый или сменил имя/username в Telegram.
   */
  async findOrCreate(input: TelegramUserInput) {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: input.telegramId },
    });
    if (
      existing &&
      existing.username === (input.username ?? null) &&
      existing.firstName === (input.firstName ?? null)
    )
      return existing;
    return this.prisma.user.upsert({
      where: { telegramId: input.telegramId },
      // Telegram не присылает username, если его нет. undefined Prisma поняла бы как «не трогать»,
      // и в базе остался бы старый ник — поэтому явно null.
      update: {
        username: input.username ?? null,
        firstName: input.firstName ?? null,
      },
      create: input,
    });
  }
}
