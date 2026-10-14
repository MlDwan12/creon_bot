import type { PrismaService } from '../prisma/prisma.service';

/**
 * Взять или продлить аренду задачи `name` на `ttlMs`. true — выполняем мы: аренда свободна,
 * истекла или уже наша. Одним запросом — две копии не возьмут её одновременно.
 */
export async function acquireLease(
  prisma: PrismaService,
  name: string,
  holder: string,
  ttlMs: number,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<unknown[]>`
    INSERT INTO "JobLease" ("name", "holder", "until")
    VALUES (${name}, ${holder}, now() + ${ttlMs} * interval '1 millisecond')
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder", "until" = EXCLUDED."until"
      WHERE "JobLease"."until" < now() OR "JobLease"."holder" = EXCLUDED."holder"
    RETURNING "name"`;
  return rows.length > 0;
}
