import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BansService } from './bans.service';
import type { ReportsService } from '../reports/reports.service';
import type { ModeratorGuard } from '../auth/moderator.guard';

/**
 * Гонка «одобрение заказа ∥ бан автора»: одобрение, закоммиченное, пока бан уже идёт, не должно
 * оставить заказ заблокированного открытым (бан ждёт блокировки заказа и видит итог одобрения).
 */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
const cfg = { get: () => url } as unknown as ConfigService;
const prisma = new PrismaService(cfg);
const other = new PrismaService(cfg);
const bans = new BansService(
  prisma,
  {} as ReportsService,
  {} as ModeratorGuard,
);

afterAll(() => Promise.all([prisma.$disconnect(), other.$disconnect()]));

it('заказ, одобренный во время бана, закрывается', async () => {
  // остатки упавшего прогона
  await prisma.order.deleteMany({
    where: { advertiser: { telegramId: 990001n } },
  });
  await prisma.user.deleteMany({ where: { telegramId: 990001n } });
  const u = await prisma.user.create({ data: { telegramId: 990001n } });
  const o = await prisma.order.create({
    data: {
      advertiserId: u.id,
      title: 't',
      description: 'd',
      budgetMinor: 10000,
      feePercent: 10,
    },
  });
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  // транзакция A — как moderatorApprove: lockOrder + PENDING → OPEN, коммит позже
  const a = other.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE id = ${o.id} FOR UPDATE`;
    await tx.order.update({ where: { id: o.id }, data: { status: 'OPEN' } });
    locked();
    await hold;
  });
  await isLocked;
  const b = bans.ban(u.id, 'test');
  await new Promise((r) => setTimeout(r, 500)); // ban дошёл до rejectPendingOrders и ждёт
  release();
  await Promise.all([a, b]);
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  expect(after?.status).toBe('CLOSED');
});
