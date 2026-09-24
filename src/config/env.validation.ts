export function validateEnv(config: Record<string, unknown>) {
  // Без MODERATOR_IDS бот запустится, но одобрять заказы будет некому.
  const required = ['BOT_TOKEN', 'DATABASE_URL', 'MODERATOR_IDS'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`,
    );
  }
  return config;
}
