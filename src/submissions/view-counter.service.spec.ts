import { vkVideoId, youtubeId } from './view-counter.service';

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

describe('vkVideoId', () => {
  it.each([
    ['https://vk.com/video-22822305_456241864', '-22822305_456241864'],
    ['https://vk.com/clip123_456', '123_456'],
    ['https://vk.com/feed?z=video-1_2%2Fabc', '-1_2'],
    ['https://vkvideo.ru/video-1_2', '-1_2'],
    ['https://vk.com/id1', null],
  ])('%s → %s', (url, id) => {
    expect(vkVideoId(url)).toBe(id);
  });
});
