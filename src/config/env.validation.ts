export function validateEnv(config: Record<string, unknown>) {
  const required = ['BOT_TOKEN', 'DATABASE_URL'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`,
    );
  }
  return config;
}
