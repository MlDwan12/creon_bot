import {
  authorInLinks,
  instagramShortcode,
  tiktokVideoId,
  videoKey,
  vkVideoId,
} from './platforms';

describe('videoKey', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'youtube:dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ'],
    [
      'https://www.tiktok.com/@anya/video/123/?is_from_webapp=1',
      'tiktok.com/@anya/video/123',
    ],
    ['https://WWW.Instagram.com/reel/AbC/', 'instagram.com/reel/AbC'],
    ['https://vk.com/feed?z=video-1_2%2Fall', 'vk.com/feed?z=video-1_2/all'],
    ['https://vk.com/video-1_2?list=x', 'vk.com/video-1_2'],
    ['https://x.com/anya/status/1789?s=20', 'x:1789'],
    ['https://twitter.com/Other/status/1789/video/1', 'x:1789'],
  ])('%s → %s', (url, key) => {
    expect(videoKey(url)).toBe(key);
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
