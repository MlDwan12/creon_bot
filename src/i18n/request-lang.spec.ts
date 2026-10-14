import type { NextFunction, Request, Response } from 'express';
import {
  requestLangMiddleware,
  setRequestLang,
  tr,
  trNum,
  withLang,
} from './request-lang';

describe('язык запроса', () => {
  it('вне запроса — русский (тесты, фоновые задачи без withLang)', () => {
    expect(tr('errors.orderNotFound')).toBe('Заказ не найден');
  });

  it('withLang — на заданном языке, и через await тоже', async () => {
    const text = await withLang('en', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return tr('errors.tooManyActive', { max: 10 });
    });
    expect(text).toBe(
      'You already have 10 active orders — close the ones you no longer need to post a new one',
    );
    expect(withLang('en', () => trNum(12500))).toBe('12,500');
  });

  it('middleware — по заголовку браузера, guard уточняет по пользователю', () => {
    const seen: string[] = [];
    const run = (acceptLanguage: string | undefined, userLang?: 'ru' | 'en') =>
      requestLangMiddleware(
        { headers: { 'accept-language': acceptLanguage } } as Request,
        {} as Response,
        (() => {
          if (userLang) setRequestLang(userLang);
          seen.push(tr('errors.notFound'));
        }) as NextFunction,
      );
    run('ru-RU,ru;q=0.9');
    run('en-US,en;q=0.9');
    run('en-US', 'ru');
    expect(seen).toEqual(['Не найдено', 'Not found', 'Не найдено']);
  });
});
