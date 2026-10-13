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
  // Подключение аккаунтов площадок (src/accounts): их токены хранятся зашифрованными этим ключом.
  if (
    (config.TIKTOK_CLIENT_KEY || config.VK_CLIENT_ID) &&
    Buffer.from(
      typeof config.SOCIAL_TOKENS_KEY === 'string'
        ? config.SOCIAL_TOKENS_KEY
        : '',
      'base64',
    ).length !== 32
  )
    throw new Error(
      'SOCIAL_TOKENS_KEY — 32 байта в base64 (openssl rand -base64 32): без него не подключить TikTok и VK',
    );
  if (
    Boolean(config.TIKTOK_CLIENT_KEY) !== Boolean(config.TIKTOK_CLIENT_SECRET)
  )
    throw new Error('TIKTOK_CLIENT_KEY и TIKTOK_CLIENT_SECRET задаются вместе');
  return config;
}
