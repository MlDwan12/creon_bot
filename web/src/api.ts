import { ApiError, type Me } from '@fixum/shared';
import { i18next, setLang } from './i18n';

export * from '@fixum/shared';

/**
 * Запрос к API сайта. Вход — cookie сессии (ставит POST /api/web/login), браузер шлёт её сам;
 * заголовок X-Fixum-Web без неё API не примет cookie — защита от подделки запросов с чужих сайтов.
 */
async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Fixum-Web': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    throw new ApiError(
      res.status,
      typeof data?.message === 'string'
        ? data.message
        : i18next.t('common.genericError'),
      data,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Кто вошёл; 401 — не вошёл, 403 с banned — заблокирован. */
export async function fetchMe() {
  const me = await request<Me>('GET', '/api/me');
  setLang(me.language);
  return me;
}

/** id бота для окна входа Telegram. */
export function fetchWebConfig() {
  return request<{ botId: number }>('GET', '/api/web/config');
}

/** Данные, которые Telegram отдаёт после подтверждения входа, — как есть, подпись проверит бэкенд. */
export type TelegramAuth = Record<string, string | number>;

export function login(data: TelegramAuth) {
  return request<void>('POST', '/api/web/login', data);
}

export function logout() {
  return request<void>('POST', '/api/web/logout');
}
