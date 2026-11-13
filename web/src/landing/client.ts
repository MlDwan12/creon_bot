import './landing.css';

/**
 * Единственный скрипт лендинга: ссылки на бота, политику и соглашение — из /api/web/config (у прода и дев-стенда
 * они разные, а сборка одна). Не ответил API — ссылки остаются на /login, там бот тоже есть.
 */
fetch('/api/web/config')
  .then((r) => (r.ok ? r.json() : null))
  .then(
    (
      c: {
        botUrl: string | null;
        privacyUrl: string | null;
        termsUrl: string | null;
      } | null,
    ) => {
      if (c?.botUrl)
        document
          .querySelectorAll<HTMLAnchorElement>('a[data-bot]')
          .forEach((a) => (a.href = c.botUrl!));
      if (c?.privacyUrl)
        document
          .querySelectorAll<HTMLAnchorElement>('a[data-privacy]')
          .forEach((a) => (a.href = c.privacyUrl!));
      if (c?.termsUrl)
        document
          .querySelectorAll<HTMLAnchorElement>('a[data-terms]')
          .forEach((a) => (a.href = c.termsUrl!));
    },
  )
  .catch(() => {});
