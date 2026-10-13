import { videoKey } from './platforms';

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
  ])('%s → %s', (url, key) => {
    expect(videoKey(url)).toBe(key);
  });
});
