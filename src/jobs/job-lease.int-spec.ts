import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { acquireLease } from './job-lease';

/** Аренда фоновых задач: при нескольких копиях бота задачи выполняет одна. */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );

const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE "JobLease"'));
afterAll(() => prisma.$disconnect());

describe('аренда задач', () => {
  it('держатель продлевает, другой ждёт, пока аренда не истечёт', async () => {
    expect(await acquireLease(prisma, 'jobs', 'a', 60_000)).toBe(true);
    expect(await acquireLease(prisma, 'jobs', 'b', 60_000)).toBe(false);
    expect(await acquireLease(prisma, 'jobs', 'a', 60_000)).toBe(true);
    // другая задача — своя аренда
    expect(await acquireLease(prisma, 'other', 'b', 60_000)).toBe(true);

    // держатель «упал» — аренда истекла
    await prisma.jobLease.update({
      where: { name: 'jobs' },
      data: { until: new Date(Date.now() - 1000) },
    });
    expect(await acquireLease(prisma, 'jobs', 'b', 60_000)).toBe(true);
    expect(await acquireLease(prisma, 'jobs', 'a', 60_000)).toBe(false);
  });

  it('две копии разом — аренду получает одна', async () => {
    const got = await Promise.all(
      ['a', 'b', 'c', 'd'].map((h) => acquireLease(prisma, 'jobs', h, 60_000)),
    );
    expect(got.filter(Boolean)).toHaveLength(1);
  });
});
