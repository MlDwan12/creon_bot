import type { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { TokenCrypto } from './token-crypto';

/**
 * Подключение аккаунтов TikTok и VK: OAuth, хранение токенов в зашифрованном виде, обновление,
 * просмотры по токену креатора. Площадки подменены через fetch — настоящих ключей в тестах нет.
 */
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test'))
  throw new Error(
    'Нужен DATABASE_URL тестовой базы (…_test) — запускайте через yarn test:int',
  );

const prisma = new PrismaService({
  get: () => url,
} as unknown as ConfigService);
const KEY = randomBytes(32).toString('base64');
const env: Record<string, string> = {
  WEBAPP_URL: 'https://app.example/',
  SOCIAL_TOKENS_KEY: KEY,
  TIKTOK_CLIENT_KEY: 'tt-key',
  TIKTOK_CLIENT_SECRET: 'tt-secret',
  VK_CLIENT_ID: '123',
};
const accounts = new AccountsService(
  { get: (k: string) => env[k] } as unknown as ConfigService,
  prisma,
);
const crypto = new TokenCrypto(KEY);

let nextTelegramId = 1n;
const user = () =>
  prisma.user.create({ data: { telegramId: nextTelegramId++ } });

/** Ответы площадки по очереди; запросы — для проверки, что ушло. */
function replies(...bodies: unknown[]) {
  // повторный spyOn возвращает тот же шпион — прошлые вызовы не нужны
  const spy = jest.spyOn(global, 'fetch').mockClear();
  for (const body of bodies)
    spy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  return spy;
}
/** i-й запрос: адрес, параметры и тело строкой (у нас тела — JSON или форма). */
const sent = (spy: jest.SpyInstance, i: number) => {
  const [url, init] = spy.mock.calls[i] as [string, RequestInit];
  return { url, init, body: init.body as string };
};

const tiktokTokens = (n: number) => ({
  access_token: `act.${n}`,
  refresh_token: `rft.${n}`,
  expires_in: 86400,
  open_id: 'tt-user-1',
  scope: 'user.info.basic,video.list',
});

/** Креатор нажал «Подключить TikTok» и вернулся с кодом. */
async function connectTiktok(userId: number, code = 'code-1') {
  const start = new URL(accounts.start(userId, 'TIKTOK'));
  replies(tiktokTokens(1));
  await accounts.complete('TIKTOK', {
    code,
    state: start.searchParams.get('state')!,
  });
  return start;
}

beforeEach(() =>
  prisma.$executeRawUnsafe('TRUNCATE "User" RESTART IDENTITY CASCADE'),
);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('подключение аккаунта', () => {
  it('TikTok: вход → токены в базе только зашифрованными → просмотры его роликов', async () => {
    const creator = await user();
    const start = await connectTiktok(creator.id);

    expect(start.origin + start.pathname).toBe(
      'https://www.tiktok.com/v2/auth/authorize/',
    );
    expect(start.searchParams.get('scope')).toBe('user.info.basic,video.list');
    expect(start.searchParams.get('redirect_uri')).toBe(
      'https://app.example/oauth/tiktok/callback',
    );
    const stored = await prisma.socialAccount.findFirstOrThrow();
    expect(stored).toMatchObject({
      platform: 'TIKTOK',
      externalId: 'tt-user-1',
    });
    expect(stored.accessToken).not.toContain('act.1');
    expect(crypto.decrypt(stored.accessToken)).toBe('act.1');
    expect(await accounts.list(creator.id)).toEqual([
      { platform: 'TIKTOK', name: 'TikTok', connected: true },
      { platform: 'VK', name: 'VK', connected: false },
    ]);

    const spy = replies({
      data: { videos: [{ id: '111', view_count: 5000, like_count: 40 }] },
      error: { code: 'ok' },
    });
    const stats = await accounts.stats(creator.id, 'TIKTOK', ['111', '222']);
    expect([...stats]).toEqual([['111', { views: 5000, likes: 40 }]]);
    const { url: reqUrl, init, body: reqBody } = sent(spy, 0);
    expect(reqUrl).toContain('/v2/video/query/');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer act.1' });
    expect(JSON.parse(reqBody)).toEqual({
      filters: { video_ids: ['111', '222'] },
    });
  });

  it('state одноразовый и только свой; чужая площадка или выдуманный — отказ', async () => {
    const creator = await user();
    const start = new URL(accounts.start(creator.id, 'TIKTOK'));
    const state = start.searchParams.get('state')!;
    await expect(
      accounts.complete('VK', { code: 'x', state, device_id: 'd' }),
    ).rejects.toThrow('устарела');
    // после неудачной попытки state сгорел
    await expect(
      accounts.complete('TIKTOK', { code: 'x', state }),
    ).rejects.toThrow('устарела');
    await expect(
      accounts.complete('TIKTOK', { code: 'x', state: 'выдуманный' }),
    ).rejects.toThrow('устарела');
    expect(await prisma.socialAccount.count()).toBe(0);
  });

  it('креатор не дал доступ к видео — не подключаем', async () => {
    const creator = await user();
    const start = new URL(accounts.start(creator.id, 'TIKTOK'));
    replies({ ...tiktokTokens(1), scope: 'user.info.basic' });
    await expect(
      accounts.complete('TIKTOK', {
        code: 'c',
        state: start.searchParams.get('state')!,
      }),
    ).rejects.toThrow('не дал доступ');
    expect(await prisma.socialAccount.count()).toBe(0);
  });

  it('один аккаунт площадки — одному креатору', async () => {
    const [a, b] = [await user(), await user()];
    await connectTiktok(a.id);
    await expect(connectTiktok(b.id)).rejects.toThrow('другому профилю');
  });

  it('VK: PKCE, device_id из payload, scope video', async () => {
    const creator = await user();
    const start = new URL(accounts.start(creator.id, 'VK'));
    expect(start.searchParams.get('scope')).toBe('video');
    const spy = replies({
      access_token: 'vk-act',
      refresh_token: 'vk-rft',
      expires_in: 3600,
      user_id: 42,
      scope: 'video',
    });
    await accounts.complete('VK', {
      payload: JSON.stringify({
        code: 'vk-code',
        state: start.searchParams.get('state'),
        device_id: 'dev-1',
        type: 'code_v2',
      }),
    });

    const body = new URLSearchParams(sent(spy, 0).body);
    // verifier, отправленный при обмене, — тот, чей хеш ушёл в ссылку входа
    expect(
      createHash('sha256')
        .update(body.get('code_verifier')!)
        .digest('base64url'),
    ).toBe(start.searchParams.get('code_challenge'));
    expect(body.get('device_id')).toBe('dev-1');
    expect(await prisma.socialAccount.findFirstOrThrow()).toMatchObject({
      platform: 'VK',
      externalId: '42',
      deviceId: 'dev-1',
    });
  });
});

describe('токены', () => {
  it('протух — обновляем, новый refresh сохраняем', async () => {
    const creator = await user();
    await connectTiktok(creator.id);
    await prisma.socialAccount.updateMany({
      data: { accessExpiresAt: new Date(Date.now() - 1000) },
    });
    const spy = replies(tiktokTokens(2), {
      data: { videos: [] },
      error: { code: 'ok' },
    });

    await accounts.stats(creator.id, 'TIKTOK', ['111']);

    const refresh = new URLSearchParams(sent(spy, 0).body);
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('rft.1');
    expect(sent(spy, 1).init.headers).toMatchObject({
      Authorization: 'Bearer act.2',
    });
    const stored = await prisma.socialAccount.findFirstOrThrow();
    expect(crypto.decrypt(stored.refreshToken)).toBe('rft.2');
  });

  it('доступ отозван — аккаунт отключается, просмотры посчитает модератор', async () => {
    const creator = await user();
    await connectTiktok(creator.id);
    await prisma.socialAccount.updateMany({
      data: { accessExpiresAt: new Date(Date.now() - 1000) },
    });
    replies({ error: 'invalid_grant', error_description: 'expired' });

    expect((await accounts.stats(creator.id, 'TIKTOK', ['111'])).size).toBe(0);
    expect(await prisma.socialAccount.count()).toBe(0);
  });

  it('площадка не ответила — пусто, аккаунт остаётся', async () => {
    const creator = await user();
    await connectTiktok(creator.id);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ETIMEDOUT'));

    expect((await accounts.stats(creator.id, 'TIKTOK', ['111'])).size).toBe(0);
    expect(await prisma.socialAccount.count()).toBe(1);
  });
});
