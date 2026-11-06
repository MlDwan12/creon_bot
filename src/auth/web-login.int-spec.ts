import type { ConfigService } from '@nestjs/config';
import type { Context, Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LOGIN_START_PREFIX, WebLoginService } from './web-login.service';

/** Вход на сайт кодом из бота: ссылка → код в Telegram → код на сайте. */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );
const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const service = new WebLoginService(prisma, new UsersService(prisma), {
  telegram: { getMe: () => Promise.resolve({ username: 'fixum_bot' }) },
} as unknown as Telegraf<Context>);
const anya = { id: 555001, username: 'anya', first_name: 'Аня' };

beforeEach(() =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "WebLogin", "User" RESTART IDENTITY CASCADE',
  ),
);
afterAll(() => prisma.$disconnect());

it('ссылка → код тому, кто открыл → вход; второй раз тем же кодом не войти', async () => {
  const { token, link } = await service.start();
  expect(link).toBe(
    `https://t.me/fixum_bot?start=${LOGIN_START_PREFIX}${token}`,
  );
  // кода ещё нет — бот не открывали
  await expect(service.verify(token, '0000')).rejects.toThrow();

  const code = await service.issueCode(token, anya);
  expect(code).toMatch(/^\d{4}$/);
  const userId = await service.verify(token, code!);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  expect(user.telegramId).toBe(BigInt(anya.id));
  await expect(service.verify(token, code!)).rejects.toThrow();
});

it('5 неверных кодов, даже одновременно, — дальше и верный не примут', async () => {
  const { token } = await service.start();
  const code = (await service.issueCode(token, anya))!;
  const wrong = code === '1111' ? '2222' : '1111';
  await Promise.allSettled(
    Array.from({ length: 20 }, () => service.verify(token, wrong)),
  );
  const row = await prisma.webLogin.findFirstOrThrow();
  expect(row.attempts).toBe(5);
  await expect(service.verify(token, code)).rejects.toThrow();
});

it('устаревшая ссылка: бот кода не даёт, сайт не впускает', async () => {
  const { token } = await service.start();
  const code = (await service.issueCode(token, anya))!;
  await prisma.webLogin.updateMany({
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(await service.issueCode(token, anya)).toBeNull();
  await expect(service.verify(token, code)).rejects.toThrow();
  expect(await service.issueCode('чужой', anya)).toBeNull();
});
