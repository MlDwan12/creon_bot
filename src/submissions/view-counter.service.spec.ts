import type { ConfigService } from '@nestjs/config';
import { youtubeId } from '../common/platforms';
import type { AccountsService } from '../accounts/accounts.service';
import { ViewCounterService } from './view-counter.service';

describe('youtubeId', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/@channel', null],
    ['не ссылка', null],
  ])('%s → %s', (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });
});

describe('ViewCounterService', () => {
  // аккаунты площадок (TikTok, VK, Instagram) здесь не подключены
  const noAccounts = {
    providerFor: () => null,
    stats: () => Promise.resolve(new Map()),
  } as unknown as AccountsService;
  const service = (env: Record<string, string>) =>
    new ViewCounterService(
      { get: (k: string) => env[k] } as ConfigService,
      noAccounts,
    );
  const refs = (urls: string[]) => urls.map((url) => ({ url, creatorId: 1 }));
  const reply = (body: unknown, ok = true) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok, json: () => Promise.resolve(body) } as Response);

  afterEach(() => jest.restoreAllMocks());

  it('без ключа площадки — вручную, с ключом — автоматически', () => {
    const post = 'https://x.com/anya/status/1789';
    expect(service({}).isAutomatic(post)).toBe(false);
    expect(service({ X_BEARER_TOKEN: 't' }).isAutomatic(post)).toBe(true);
    expect(
      service({ X_BEARER_TOKEN: 't' }).isAutomatic('https://x.com/anya'),
    ).toBe(false);
    // ?v= на чужом домене — не YouTube
    expect(
      service({ YOUTUBE_API_KEY: 'k' }).isAutomatic(
        'https://tiktok.com/@a?v=dQw4w9WgXcQ',
      ),
    ).toBe(false);
  });

  it('X: просмотры видео из поста, удалённый пост и пост без видео — вручную', async () => {
    const fetch = reply({
      data: [
        {
          id: '1',
          public_metrics: { like_count: 7 },
          attachments: { media_keys: ['m1'] },
        },
        { id: '2', public_metrics: { like_count: 1 } },
      ],
      includes: {
        media: [
          {
            media_key: 'm1',
            type: 'video',
            public_metrics: { view_count: 900 },
          },
        ],
      },
      errors: [{ resource_id: '3', title: 'Not Found Error' }],
    });
    const urls = [
      'https://x.com/a/status/1',
      'https://twitter.com/A/status/1/video/1',
      'https://x.com/a/status/2',
      'https://x.com/a/status/3',
    ];

    const stats = await service({ X_BEARER_TOKEN: 'secret' }).fetchViews(
      refs(urls),
    );

    expect(stats.get(urls[0])).toEqual({ views: 900, likes: 7 });
    expect(stats.get(urls[1])).toEqual({ views: 900, likes: 7 });
    expect(stats.has(urls[2])).toBe(false);
    expect(stats.has(urls[3])).toBe(false);
    // один запрос на пачку, ключ — в заголовке, а не в адресе
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('ids=1,2,3');
    expect(url).not.toContain('secret');
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('API не ответило — пустая карта, не исключение', async () => {
    reply({ title: 'Unauthorized' }, false);
    const stats = await service({ X_BEARER_TOKEN: 't' }).fetchViews(
      refs(['https://x.com/a/status/1']),
    );
    expect(stats.size).toBe(0);
  });
});
