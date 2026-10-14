import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { type Lang, langFromTelegram, translator } from './i18n';

/**
 * Язык текущего запроса — чтобы сервисы писали ошибки на языке пользователя, не передавая язык
 * через каждый вызов. Ставит middleware (по заголовку браузера), уточняет InitDataGuard (язык
 * пользователя из профиля или Telegram). Вне запроса (тесты, фоновые задачи) — русский, если
 * не задан явно через withLang.
 */
const store = new AsyncLocalStorage<{ lang: Lang }>();

/** Express-middleware: язык по Accept-Language — для страниц без авторизации (OAuth callback). */
export function requestLangMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  store.run({ lang: langFromTelegram(req.headers['accept-language']) }, next);
}

/** InitDataGuard узнал пользователя — дальше по запросу его язык. */
export function setRequestLang(lang: Lang) {
  const current = store.getStore();
  if (current) current.lang = lang;
}

export function requestLang(): Lang {
  return store.getStore()?.lang ?? 'ru';
}

/** Выполнить на языке `lang` — для фоновых задач, где запроса нет. */
export function withLang<T>(lang: Lang, fn: () => T): T {
  return store.run({ lang }, fn);
}

/** Перевод на язык текущего запроса: `tr('errors.orderNotFound')`. */
export function tr(key: string, params?: Record<string, unknown>): string {
  return translator(requestLang())(key, params);
}

/** Число с разделителями на языке запроса: «12 500» / «12,500». */
export function trNum(n: number): string {
  return n.toLocaleString(requestLang() === 'en' ? 'en-US' : 'ru-RU');
}
