export function validateEnv(config: Record<string, unknown>) {
  // Без MODERATOR_IDS бот запустится, но одобрять заказы будет некому.
  // WEBAPP_URL — HTTPS-адрес Mini App: на него ведут кнопки бота.
  const required = ['BOT_TOKEN', 'DATABASE_URL', 'MODERATOR_IDS', 'WEBAPP_URL'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`,
    );
  }
  // Telegram id модераторов через запятую — по ним шлются уведомления (BigInt).
  const moderators = String(config.MODERATOR_IDS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (moderators.some((id) => !/^\d+$/.test(id)))
    throw new Error(
      'MODERATOR_IDS — Telegram id через запятую, например 123,456',
    );
  // Комиссия площадки для новых заказов, % (src/orders/budget.ts); не задана — 20.
  const fee = config.PLATFORM_FEE_PERCENT;
  if (fee !== undefined && fee !== '') {
    const n = Number(fee);
    if (!Number.isInteger(n) || n < 0 || n > 90)
      throw new Error('PLATFORM_FEE_PERCENT — целое число от 0 до 90');
  }
  // Адрес сайта (web/) — на нём открывается публичный отчёт по ссылке; не задан — делиться нельзя.
  const web = typeof config.WEB_URL === 'string' ? config.WEB_URL : '';
  if (web && !/^https?:\/\/[^\s/]+\/?$/.test(web))
    throw new Error(
      'WEB_URL — адрес сайта без пути, например https://site.fixumapp.com',
    );
  // Вход на сайт через Telegram (OpenID Connect, src/auth/oidc.util.ts); без WEB_URL выключен
  if (
    Boolean(config.TELEGRAM_OIDC_CLIENT_ID) !==
    Boolean(config.TELEGRAM_OIDC_CLIENT_SECRET)
  )
    throw new Error(
      'TELEGRAM_OIDC_CLIENT_ID и TELEGRAM_OIDC_CLIENT_SECRET задаются вместе',
    );
  // Подключение аккаунтов площадок (src/accounts): их токены хранятся зашифрованными этим ключом.
  if (
    (config.TIKTOK_CLIENT_KEY ||
      config.VK_CLIENT_ID ||
      config.INSTAGRAM_APP_ID) &&
    Buffer.from(
      typeof config.SOCIAL_TOKENS_KEY === 'string'
        ? config.SOCIAL_TOKENS_KEY
        : '',
      'base64',
    ).length !== 32
  )
    throw new Error(
      'SOCIAL_TOKENS_KEY — 32 байта в base64 (openssl rand -base64 32): без него не подключить TikTok, VK и Instagram',
    );
  if (
    Boolean(config.TIKTOK_CLIENT_KEY) !== Boolean(config.TIKTOK_CLIENT_SECRET)
  )
    throw new Error('TIKTOK_CLIENT_KEY и TIKTOK_CLIENT_SECRET задаются вместе');
  if (Boolean(config.INSTAGRAM_APP_ID) !== Boolean(config.INSTAGRAM_APP_SECRET))
    throw new Error('INSTAGRAM_APP_ID и INSTAGRAM_APP_SECRET задаются вместе');
  // Метрики в Grafana Cloud (src/monitoring/metrics.ts): без любого из трёх — молча выключены бы
  const grafana = [
    'GRAFANA_OTLP_URL',
    'GRAFANA_OTLP_INSTANCE_ID',
    'GRAFANA_OTLP_TOKEN',
  ].filter((k) => config[k]);
  if (grafana.length && grafana.length < 3)
    throw new Error(
      'GRAFANA_OTLP_URL, GRAFANA_OTLP_INSTANCE_ID и GRAFANA_OTLP_TOKEN задаются вместе',
    );
  return config;
}
