/**
 * @nestjs/config 12 — только ESM, а Jest грузит модули как CommonJS. Интеграционным тестам
 * пакет не нужен: PrismaService получает подставной объект с `get`, здесь только имя класса.
 */
export class ConfigService {}
