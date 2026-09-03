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

  findOrCreate(input: TelegramUserInput) {
    return this.prisma.user.upsert({
      where: { telegramId: input.telegramId },
      update: { username: input.username, firstName: input.firstName },
      create: input,
    });
  }
}
