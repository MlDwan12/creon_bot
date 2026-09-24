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
  return config;
}
