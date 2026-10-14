import type { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService, MAX_PER_PLATFORM } from './accounts.service';
import { TokenCrypto } from './token-crypto';

/**
 * Подключение аккаунтов TikTok, VK и Instagram: OAuth, хранение токенов в зашифрованном виде, обновление,
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
  INSTAGRAM_APP_ID: 'ig-app',
  INSTAGRAM_APP_SECRET: 'ig-secret',
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

const tiktokTokens = (n: number, openId = 'tt-user-1') => ({
  access_token: `act.${n}`,
  refresh_token: `rft.${n}`,
  expires_in: 86400,
  open_id: openId,
  scope: 'user.info.basic,video.list',
});
const tiktokName = (name: string) => ({
  data: { user: { display_name: name } },
});

/** Креатор нажал «Подключить TikTok» и вернулся с кодом. */
async function connectTiktok(
  userId: number,
  code = 'code-1',
  openId = 'tt-user-1',
  n = 1,
) {
  const start = new URL(await accounts.start(userId, 'TIKTOK'));
  replies(tiktokTokens(n, openId), tiktokName(`Аня ${n}`));
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
    expect(start.searchParams.get('disable_auto_auth')).toBe('1');
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
      {
        platform: 'TIKTOK',
        name: 'TikTok',
        accounts: [{ id: stored.id, label: 'Аня 1' }],
        canAdd: true,
      },
      { platform: 'VK', name: 'VK', accounts: [], canAdd: true },
      { platform: 'INSTAGRAM', name: 'Instagram', accounts: [], canAdd: true },
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
    const start = new URL(await accounts.start(creator.id, 'TIKTOK'));
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

  it('вход начат в одной копии бота, вернулся в другую — подключаем; просроченный — нет', async () => {
    const creator = await user();
    const other = new AccountsService(
      { get: (k: string) => env[k] } as unknown as ConfigService,
      prisma,
    );
    const start = new URL(await accounts.start(creator.id, 'TIKTOK'));
    replies(tiktokTokens(1), tiktokName('Аня'));
    await other.complete('TIKTOK', {
      code: 'c',
      state: start.searchParams.get('state')!,
    });
    expect(await prisma.socialAccount.count()).toBe(1);
    expect(await prisma.oAuthPending.count()).toBe(0);

    const late = new URL(await accounts.start(creator.id, 'VK'));
    await prisma.oAuthPending.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      other.complete('VK', {
        code: 'c',
        device_id: 'd',
        state: late.searchParams.get('state')!,
      }),
    ).rejects.toThrow('устарела');
  });

  it('креатор не дал доступ к видео — не подключаем', async () => {
    const creator = await user();
    const start = new URL(await accounts.start(creator.id, 'TIKTOK'));
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
    const start = new URL(await accounts.start(creator.id, 'VK'));
    expect(start.searchParams.get('scope')).toBe('video');
    const spy = replies(
      {
        access_token: 'vk-act',
        refresh_token: 'vk-rft',
        expires_in: 3600,
        user_id: 42,
        scope: 'video',
      },
      { user: { first_name: 'Аня', last_name: 'Котова' } },
    );
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
      label: 'Аня Котова',
    });
  });

  it('несколько аккаунтов площадки: просмотры ищем по всем, отключается только свой', async () => {
    const [creator, stranger] = [await user(), await user()];
    await connectTiktok(creator.id, 'c1', 'tt-a', 1);
    await connectTiktok(creator.id, 'c2', 'tt-b', 2);
    // тот же аккаунт подключили снова — не дубль, а обновление
    await connectTiktok(creator.id, 'c3', 'tt-a', 3);
    const [a, b] = await prisma.socialAccount.findMany({
      orderBy: { id: 'asc' },
    });
    expect([a.label, b.label]).toEqual(['Аня 3', 'Аня 2']);

    // ролик 111 — с первого аккаунта, 222 — со второго
    const spy = replies(
      {
        data: { videos: [{ id: '111', view_count: 10 }] },
        error: { code: 'ok' },
      },
      {
        data: { videos: [{ id: '222', view_count: 20 }] },
        error: { code: 'ok' },
      },
    );
    const stats = await accounts.stats(creator.id, 'TIKTOK', ['111', '222']);
    expect(stats.get('111')?.views).toBe(10);
    expect(stats.get('222')?.views).toBe(20);
    // второй аккаунт спрашиваем только о том, что не нашёл первый
    expect(JSON.parse(sent(spy, 1).body)).toEqual({
      filters: { video_ids: ['222'] },
    });

    await accounts.disconnect(stranger.id, a.id);
    expect(await prisma.socialAccount.count()).toBe(2);
    await accounts.disconnect(creator.id, a.id);
    expect(await prisma.socialAccount.count()).toBe(1);
  });

  it(`больше ${MAX_PER_PLATFORM} аккаунтов одной площадки — нельзя`, async () => {
    const creator = await user();
    for (let i = 0; i < MAX_PER_PLATFORM; i++)
      await connectTiktok(creator.id, `c${i}`, `tt-${i}`, i);
    const [tiktok] = await accounts.list(creator.id);
    expect(tiktok.canAdd).toBe(false);
    await expect(accounts.start(creator.id, 'TIKTOK')).rejects.toThrow(
      `до ${MAX_PER_PLATFORM} аккаунтов`,
    );
    // другая площадка — своя квота
    await accounts.start(creator.id, 'VK');
  });

  it('Instagram: короткий токен → долгий, ник в профиле, просмотры по коду из ссылки', async () => {
    const creator = await user();
    const start = new URL(await accounts.start(creator.id, 'INSTAGRAM'));
    expect(start.origin + start.pathname).toBe(
      'https://www.instagram.com/oauth/authorize',
    );
    const spy = replies(
      {
        data: [
          {
            access_token: 'ig-short',
            user_id: 777,
            permissions:
              'instagram_business_basic,instagram_business_manage_insights',
          },
        ],
      },
      { access_token: 'ig-long', expires_in: 5_184_000 },
      { username: 'anya.reels' },
    );
    await accounts.complete('INSTAGRAM', {
      code: 'ig-code#_',
      state: start.searchParams.get('state')!,
    });
    expect(new URLSearchParams(sent(spy, 0).body).get('code')).toBe('ig-code');
    expect(sent(spy, 1).url).toContain('ig_exchange_token');
    const stored = await prisma.socialAccount.findFirstOrThrow();
    expect(stored).toMatchObject({
      platform: 'INSTAGRAM',
      externalId: '777',
      label: '@anya.reels',
    });
    expect(crypto.decrypt(stored.accessToken)).toBe('ig-long');

    const statsSpy = replies(
      {
        data: [
          { id: 'm1', shortcode: 'OTHER1', like_count: 1 },
          { id: 'm2', shortcode: 'C8abcD12', like_count: 9 },
        ],
        paging: {},
      },
      { data: [{ name: 'views', values: [{ value: 1234 }] }] },
    );
    const stats = await accounts.stats(creator.id, 'INSTAGRAM', ['C8abcD12']);
    expect([...stats]).toEqual([['C8abcD12', { views: 1234, likes: 9 }]]);
    expect(sent(statsSpy, 1).url).toContain('/m2/insights?metric=views');
  });

  it('Instagram: протух — продлеваем сам долгий токен', async () => {
    const creator = await user();
    await prisma.socialAccount.create({
      data: {
        userId: creator.id,
        platform: 'INSTAGRAM',
        externalId: '777',
        accessToken: crypto.encrypt('ig-old'),
        refreshToken: crypto.encrypt('ig-old'),
        accessExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const spy = replies(
      { access_token: 'ig-new', expires_in: 5_184_000 },
      { data: [], paging: {} },
    );
    await accounts.stats(creator.id, 'INSTAGRAM', ['C8abcD12']);
    expect(sent(spy, 0).url).toContain('ig_refresh_token');
    expect(sent(spy, 0).url).toContain('access_token=ig-old');
    const stored = await prisma.socialAccount.findFirstOrThrow();
    expect(crypto.decrypt(stored.refreshToken)).toBe('ig-new');
    expect(stored.externalId).toBe('777');
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
