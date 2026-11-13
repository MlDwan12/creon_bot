import './landing.css';

/**
 * Единственный скрипт лендинга и юридических страниц: ссылки на бота — из /api/web/config (у прода и
 * дев-стенда боты разные, а сборка одна). Не ответил API — ссылки остаются на /login, там бот тоже есть.
 */
fetch('/api/web/config')
  .then((r) => (r.ok ? r.json() : null))
  .then((c: { botUrl: string | null } | null) => {
    if (c?.botUrl)
      document
        .querySelectorAll<HTMLAnchorElement>('a[data-bot]')
        .forEach((a) => (a.href = c.botUrl!));
  })
  .catch(() => {});
