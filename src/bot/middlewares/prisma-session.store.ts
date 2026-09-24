import type { Prisma } from '@prisma/client';
import type { SessionStore } from 'telegraf';
import type { PrismaService } from '../../prisma/prisma.service';

// telegraf экспортирует только объединение Sync|Async — берём асинхронную ветку.
type AsyncSessionStore = Extract<
  SessionStore<object>,
  { get: (name: string) => Promise<unknown> }
>;

/**
 * Хранилище для `session()` в Postgres вместо памяти процесса: иначе каждый редеплой
 * обрывал бы недозаполненные формы (создание заказа, отправка видео, причины отклонения).
 */
export function prismaSessionStore(prisma: PrismaService): AsyncSessionStore {
  return {
    async get(key: string) {
      const row = await prisma.botSession.findUnique({ where: { key } });
      return row?.data as object | undefined;
    },
    async set(key: string, value: object) {
      const data = value as Prisma.InputJsonObject;
      await prisma.botSession.upsert({
        where: { key },
        create: { key, data },
        update: { data },
      });
    },
    async delete(key: string) {
      await prisma.botSession.deleteMany({ where: { key } });
    },
  };
}
