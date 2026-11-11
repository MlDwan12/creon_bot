import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import type { ViewCounterService } from '../submissions/view-counter.service';
import { PayoutsService } from './payouts.service';

/**
 * Гонка «заявка на вывод ∥ модератор отменил начисление за удалённую публикацию»: баланс собирается
 * несколькими запросами, и отмена между ними не должна дать вывести отменённое.
 */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
const cfg = { get: () => url } as unknown as ConfigService;
const prisma = new PrismaService(cfg);
const other = new PrismaService(cfg);
const payouts = new PayoutsService(prisma);
const submissions = new SubmissionsService(other, {} as ViewCounterService);

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Payout", "Submission", "Order", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => Promise.all([prisma.$disconnect(), other.$disconnect()]));

it('отмена начисления между запросами баланса не даёт вывести отменённое', async () => {
  const advertiser = await prisma.user.create({ data: { telegramId: 1n } });
  const creator = await prisma.user.create({
    data: {
      telegramId: 2n,
      payoutWallet: 'TXYZabcdefghijkmnopqrstuvwxyz12345',
    },
  });
  const order = await prisma.order.create({
    data: {
      advertiserId: advertiser.id,
      title: 't',
      description: 'd',
      budgetMinor: 100_000,
      feePercent: 10,
      cpmMinor: 100,
      status: 'OPEN',
    },
  });
  const old = new Date(Date.now() - 30 * 86_400_000);
  const approved = {
    orderId: order.id,
    creatorId: creator.id,
    status: 'MODERATOR_APPROVED' as const,
    decidedAt: old,
  };
  // A — итог зафиксирован, 100 USDT к выводу; B — 50 USDT ещё в холде
  await prisma.submission.create({
    data: { ...approved, payoutMinor: 10_000, finalizedAt: old },
  });
  const b = await prisma.submission.create({
    data: { ...approved, payoutMinor: 5_000 },
  });

  // После первого запроса баланса модератор отменяет B (публикацию удалили); остальные запросы
  // баланса уходят только после отмены.
  // настоящий balance — до подмены шпионом
  const original = new PayoutsService(prisma);
  jest.spyOn(payouts, 'balance').mockImplementation((id, db) => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const wrap =
      (target: object, fn: (...a: unknown[]) => unknown) =>
      async (...a: unknown[]) => {
        if (calls++ > 0) {
          await gate;
          return fn.apply(target, a) as unknown;
        }
        const result: unknown = await fn.apply(target, a);
        await submissions.publicationDeleted(b.id, 99n);
        release();
        return result;
      };
    const intercept = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(t, key) {
          const value: unknown = t[key as keyof T];
          if (typeof value === 'function')
            return wrap(t, value as (...a: unknown[]) => unknown);
          if (value && typeof value === 'object') return intercept(value);
          return value;
        },
      });
    return original.balance(id, intercept(db!));
  });

  const result = await payouts.requestPayout(creator.id, 15_000).then(
    () => 'created',
    (err: Error) => err.message,
  );
  expect(result).toBe('Сумма больше доступного баланса');
  expect(await prisma.payout.count()).toBe(0);
});
