import { BadRequestException } from '@nestjs/common';
import { assertNoContacts, parseFeedback, parseLinks } from './profile-input';

describe('parseFeedback', () => {
  it('оценка обязательна, отзыв и портфолио — по желанию', () => {
    expect(parseFeedback({ rating: 5 })).toEqual({
      rating: 5,
      review: null,
      portfolioAllowed: false,
    });
    expect(
      parseFeedback({
        rating: 4,
        review: '  Отлично ',
        portfolioAllowed: true,
      }),
    ).toEqual({ rating: 4, review: 'Отлично', portfolioAllowed: true });
  });

  it('заглушка вместо отзыва — как без отзыва', () => {
    expect(parseFeedback({ rating: 3, review: '...' }).review).toBeNull();
  });

  it('отзыв с контактами не принимает', () => {
    expect(() =>
      parseFeedback({ rating: 5, review: 'Супер, пишите мне @ivan_petrov' }),
    ).toThrow(BadRequestException);
  });

  it.each([[undefined], [0], [6], [4.5], ['5']])(
    'отклоняет оценку %p',
    (rating) => {
      expect(() => parseFeedback({ rating })).toThrow(BadRequestException);
    },
  );
});

describe('parseLinks', () => {
  it('принимает ссылки своих соцсетей, пустое — удаляет', () => {
    expect(
      parseLinks({
        tiktokUrl: 'https://www.tiktok.com/@creator',
        youtubeUrl: ' https://youtu.be/abc ',
        vkUrl: '',
      }),
    ).toEqual({
      tiktokUrl: 'https://www.tiktok.com/@creator',
      youtubeUrl: 'https://youtu.be/abc',
      vkUrl: null,
    });
  });

  it.each([
    ['http вместо https', { vkUrl: 'http://vk.com/id1' }],
    ['чужой домен', { tiktokUrl: 'https://evil.com/tiktok.com' }],
    ['похожий домен', { vkUrl: 'https://notvk.com/id1' }],
    ['javascript-ссылка', { youtubeUrl: 'javascript:alert(1)' }],
    ['не ссылка', { vkUrl: 'vk.com/id1' }],
  ])('отклоняет: %s', (_name, body) => {
    expect(() => parseLinks(body)).toThrow(BadRequestException);
  });
});

describe('assertNoContacts', () => {
  it('пропускает обычный текст, в том числе со словом «телеграм»', () => {
    expect(() =>
      assertNoContacts('Звук тихий, для телеграма не подойдёт'),
    ).not.toThrow();
  });

  it.each(['мой номер 89991234567', 'почта ivan@mail.ru', 'wa.me/79991234567'])(
    'отклоняет: %s',
    (text) => {
      expect(() => assertNoContacts(text)).toThrow(BadRequestException);
    },
  );
});
