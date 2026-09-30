# creon_bot

Биржа UGC-рекламы в Telegram: Mini App плюс бот для входа и уведомлений.

Рекламодатель задаёт бюджет заказа → модератор одобряет его и ставит цену за 1000 просмотров → креаторы берут слот (5 дней), публикуют ролик у себя и сдают ссылку → модератор фиксирует просмотры, деньги списываются из бюджета и начисляются на баланс креатора → через 3 дня добор просмотров. Заказ закрывается, когда кончается бюджет. Выплаты креаторам — по заявке на вывод, вручную командой.

Роли: любой пользователь может и размещать заказы, и откликаться на них. Модераторы — список Telegram ID из `MODERATOR_IDS`. Стороны не видят контактов друг друга, общение — через поддержку в боте.

## Стек

NestJS · `nestjs-telegraf` (Telegraf, long polling) · PostgreSQL · Prisma 7 · Mini App на Vue 3 + Vite (`webapp/`, собранную статику раздаёт Nest)

## Структура `src/`

Модуль на фичу: в каждой папке свой `*.module.ts`, сервисы, контроллеры API и чистые функции со `*.spec.ts` рядом.

| Папка | Что внутри |
|---|---|
| `config/` | проверка env при старте |
| `prisma/` | `PrismaService` (глобальный) |
| `common/` | деньги, валидация, поиск контактов, площадки, форматирование, `ParseIdPipe`, логгер |
| `auth/` | проверка initData, гарды модератора и лимита запросов, `/api/me` |
| `users/` | пользователи, баны |
| `orders/` | заказы: каталог, «Мои заказы», расчёты бюджета, сроки, отчёт рекламодателю |
| `submissions/` | слоты и ролики креаторов, счётчик просмотров (YouTube API) |
| `profiles/` | профили креаторов |
| `reports/` | жалобы |
| `payouts/` | баланс креатора, заявки на вывод |
| `moderation/` | API модератора, статистика |
| `support/` | переписка с поддержкой (темы в группе `SUPPORT_CHAT_ID`) |
| `telegram/` | бот: `/start`, уведомления, фото профилей |
| `jobs/` | фоновые задачи по срокам |
| `health/` | `/api/health` для HEALTHCHECK |

`src/flows.int-spec.ts` — интеграционные тесты сервисов на базе `creon_bot_test`.

## Установка

```bash
yarn install
(cd webapp && yarn install)
```

> Версия CLI `prisma` закреплена и должна совпадать с `@prisma/client` 7.x: у npm-тега `latest` может оказаться нестабильный 8.x с другим CLI.

## Настройка

1. Скопировать `.env.example` в `.env` и заполнить:
   - `BOT_TOKEN` — токен бота от @BotFather
   - `DATABASE_URL` — строка подключения к Postgres
   - `MODERATOR_IDS` — Telegram ID модераторов через запятую
   - `WEBAPP_URL` — HTTPS-адрес Mini App (локально — через ngrok)
   - необязательные `SUPPORT_CHAT_ID`, `PLATFORM_FEE_PERCENT`, `YOUTUBE_API_KEY` — см. комментарии в `.env.example`
2. Поднять локальный Postgres:
   ```bash
   docker compose up -d
   ```
3. Накатить схему БД:
   ```bash
   yarn prisma:migrate
   ```

## Запуск

```bash
# development
yarn start:dev

# production
yarn build
yarn start:prod
```

## Полезные команды

```bash
yarn prisma:studio    # UI для просмотра/редактирования БД
yarn prisma:migrate   # применить новую миграцию после правки schema.prisma
```

## Прод-деплой

`.github/workflows/deploy.yml` после успешного CI на `main` собирает Docker-образ, пушит его в GHCR (`ghcr.io/<repo>:latest`) и по SSH разворачивает на сервере через `docker-compose.prod.yml` (Nest-приложение + Postgres в докере). Образ при старте контейнера сам накатывает миграции (`docker-entrypoint.sh` → `prisma migrate deploy`) перед запуском бота.

Что нужно на сервере и в секретах репозитория (Settings → Secrets and variables → Actions):

- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` — доступ по SSH к серверу.
- `DEPLOY_PATH` — директория на сервере с `docker-compose.prod.yml`.
- В `DEPLOY_PATH` на сервере вручную положить `.env` с `BOT_TOKEN` и `MODERATOR_IDS` (`DATABASE_URL` в проде уже задан в `docker-compose.prod.yml` и указывает на контейнер `db`).

Ручной прогон деплоя без пуша: вкладка Actions → workflow **Deploy** → Run workflow.
