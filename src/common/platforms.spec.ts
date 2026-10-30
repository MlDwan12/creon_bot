import {
  authorInLinks,
  expandTiktokShortLink,
  instagramShortcode,
  isTiktokShortLink,
  tiktokVideoId,
  videoIdKey,
  videoKey,
  vkVideoId,
} from './platforms';

describe('videoKey', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'youtube:dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ/', 'youtube:dQw4w9WgXcQ'],
    ['https://www.youtube.com/v/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    // один ролик под разными ссылками — один ключ: иначе его оплатили бы дважды
    [
      'https://www.tiktok.com/@anya/video/12345/?is_from_webapp=1',
      'tiktok:12345',
    ],
    ['https://www.tiktok.com/@ANYA/video/12345', 'tiktok:12345'],
    ['https://www.tiktok.com/@other/video/12345', 'tiktok:12345'],
    ['https://m.tiktok.com/v/12345.html', 'tiktok:12345'],
    ['https://WWW.Instagram.com/reel/AbCdE/', 'instagram:AbCdE'],
    ['https://instagram.com/p/AbCdE', 'instagram:AbCdE'],
    ['https://www.instagram.com/anya/reels/AbCdE/', 'instagram:AbCdE'],
    ['https://vk.com/feed?z=video-1_2%2Fall', 'vk:-1_2'],
    ['https://vk.com/video-1_2?list=x', 'vk:-1_2'],
    ['https://vkvideo.ru/video-1_2', 'vk:-1_2'],
    ['https://vk.com/clip-1_2', 'vk:-1_2'],
    ['https://x.com/anya/status/1789?s=20', 'x:1789'],
    ['https://twitter.com/Other/status/1789/video/1', 'x:1789'],
    // тот же id и в адресе, и в параметре — можно
    ['https://youtu.be/dQw4w9WgXcQ?v=dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    ['https://vk.com/video-1_2?z=video-1_2%2Fall', 'vk:-1_2'],
    // ?v= в ссылке другой площадки не занимает чужой ролик YouTube
    ['https://www.tiktok.com/@x/video/12345?v=dQw4w9WgXcQ', 'tiktok:12345'],
    // старые ссылки без id — по домену и пути
    ['https://www.tiktok.com/@anya/', 'tiktok.com/@anya'],
  ])('%s → %s', (url, key) => {
    expect(videoKey(url)).toBe(key);
  });
});

describe('videoIdKey', () => {
  it.each([
    'https://vm.tiktok.com/ZMabc/',
    'https://www.youtube.com/@channel',
    'https://evilyoutu.be/dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://x.com/anya',
    // в адресе один ролик, в параметре другой — площадка покажет не тот, что посчитали бы
    'https://www.youtube.com/shorts/jNQXAC9IVRw?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/jNQXAC9IVRw?v=dQw4w9WgXcQ',
    'https://youtu.be/jNQXAC9IVRw?v=dQw4w9WgXcQ',
    'https://vk.com/video1_2?z=video3_4',
    // переходы на чужой сайт через площадку
    'https://www.youtube.com/redirect?q=https://example.org&v=dQw4w9WgXcQ',
    'https://vk.com/away.php?to=https://example.org&z=video1_2',
    // нули впереди: тот же пост под другим ключом
    'https://x.com/jack/status/020',
    'https://www.tiktok.com/@anya/video/07312345678901234567',
    'https://vk.com/video1_02',
    'https://vk.com/video-01_2',
  ])('%s — не ролик', (url) => {
    expect(videoIdKey(url)).toBeNull();
  });
});

describe('tiktokVideoId', () => {
  it.each([
    [
      'https://www.tiktok.com/@anya/video/7312345678901234567?lang=ru',
      '7312345678901234567',
    ],
    ['https://m.tiktok.com/v/7312345678901234567.html', '7312345678901234567'],
    ['https://vm.tiktok.com/ZMabc/', null],
    ['https://www.tiktok.com/@anya', null],
    ['https://example.com/video/7312345678901234567', null],
  ])('%s → %s', (url, id) => {
    expect(tiktokVideoId(url)).toBe(id);
  });
});

describe('instagramShortcode', () => {
  it.each([
    ['https://www.instagram.com/reel/C8abc_D-12/?igsh=xyz', 'C8abc_D-12'],
    ['https://instagram.com/reels/C8abcD12', 'C8abcD12'],
    ['https://www.instagram.com/p/C8abcD12/', 'C8abcD12'],
    ['https://www.instagram.com/anya/reel/C8abcD12/', 'C8abcD12'],
    ['https://www.instagram.com/anya/', null],
    ['https://example.com/reel/C8abcD12', null],
  ])('%s → %s', (url, code) => {
    expect(instagramShortcode(url)).toBe(code);
  });
});

describe('vkVideoId', () => {
  it.each([
    ['https://vk.com/video-123_456', '-123_456'],
    ['https://vkvideo.ru/video123_456?list=x', '123_456'],
    ['https://vk.com/clip-1_2', '-1_2'],
    ['https://vk.com/feed?z=video-1_2%2Fall', '-1_2'],
    ['https://vk.com/anya', null],
    ['https://example.com/video-1_2', null],
  ])('%s → %s', (url, id) => {
    expect(vkVideoId(url)).toBe(id);
  });
});

describe('authorInLinks', () => {
  const yt = {
    platform: 'YOUTUBE' as const,
    id: 'UCabc123',
    handle: 'Anya_UGC',
    name: 'Аня',
  };
  const x = { platform: 'X' as const, id: '42', handle: 'anya', name: 'Аня' };
  it.each([
    [yt, 'https://www.youtube.com/@anya_ugc', true],
    [yt, 'https://m.youtube.com/@Anya_UGC/shorts', true],
    [yt, 'https://youtube.com/channel/UCabc123', true],
    [yt, 'https://youtube.com/channel/ucabc123', false], // id канала — с учётом регистра
    [yt, 'https://www.youtube.com/@anya_ugc2', false],
    [yt, 'https://x.com/anya_ugc', false],
    [{ ...yt, handle: null }, 'https://www.youtube.com/@anya_ugc', false],
    [x, 'https://x.com/Anya', true],
    [x, 'https://twitter.com/anya/', true],
    [x, 'https://x.com/anya2', false],
    [x, 'https://www.youtube.com/@anya', false],
  ])('%o + %s → %s', (author, link, expected) => {
    expect(authorInLinks(author, ['не ссылка', link])).toBe(expected);
  });
});

describe('expandTiktokShortLink', () => {
  /** Подменный fetch: адрес → куда редиректит. */
  const redirects =
    (map: Record<string, string>): typeof fetch =>
    (input) =>
      Promise.resolve(
        new Response(null, {
          status: 301,
          headers: map[String(input)] ? { location: map[String(input)] } : {},
        }),
      );

  it('раскрывает в ссылку на ролик без меток, по цепочке редиректов', async () => {
    expect(
      await expandTiktokShortLink(
        'https://vm.tiktok.com/ZMabc/',
        redirects({
          'https://vm.tiktok.com/ZMabc/':
            'https://m.tiktok.com/v/12345.html?_r=1',
          'https://m.tiktok.com/v/12345.html':
            'https://www.tiktok.com/@anya/video/12345?_t=x',
        }),
      ),
    ).toBe('https://m.tiktok.com/v/12345.html');
  });

  it.each([
    ['чужой домен', 'https://evil.com/@a/video/12345'],
    ['http вместо https', 'http://www.tiktok.com/@a/video/12345'],
    ['не ролик', 'https://www.tiktok.com/@anya'],
  ])('%s — null', async (_, location) => {
    expect(
      await expandTiktokShortLink(
        'https://vm.tiktok.com/ZMabc/',
        redirects({ 'https://vm.tiktok.com/ZMabc/': location }),
      ),
    ).toBeNull();
  });

  it('TikTok не ответил — null', async () => {
    expect(
      await expandTiktokShortLink('https://vm.tiktok.com/ZMabc/', () =>
        Promise.reject(new Error('timeout')),
      ),
    ).toBeNull();
  });
});

describe('isTiktokShortLink', () => {
  it.each([
    ['https://vm.tiktok.com/ZMabc/', true],
    ['https://vt.tiktok.com/ZSabc/', true],
    ['https://www.tiktok.com/t/ZTabc/', true],
    ['https://www.tiktok.com/@anya/video/12345', false],
    ['https://vm.tiktok.com.evil.com/ZMabc/', false],
  ])('%s → %s', (url, short) => {
    expect(isTiktokShortLink(url)).toBe(short);
  });
});
