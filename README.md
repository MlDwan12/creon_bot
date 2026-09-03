# creon_bot

Telegram-бот — посредник между рекламодателем и креатором.

Рекламодатель размещает заказ → креаторы просматривают открытые заказы и откликаются, прикладывая ссылку на готовое видео → отклик проверяет модератор → после одобрения модератором его подтверждает рекламодатель.

Роли: любой пользователь бота может и размещать заказы (как рекламодатель), и откликаться на них (как креатор). Модератор — фиксированный список Telegram ID из `MODERATOR_IDS`, у него отдельное меню только с модерацией и статистикой. Оплата в этой версии происходит вне бота — цена в заказе указывается просто как текст.

## Стек

NestJS · `nestjs-telegraf` (Telegraf, long polling) · PostgreSQL · Prisma

## Установка

```bash
yarn add telegraf nestjs-telegraf @prisma/client @nestjs/config @prisma/adapter-pg
yarn add -D prisma@7.10.0
```

> Важно: у пакета `prisma` npm-тег `latest` на момент написания указывает на нестабильный `8.0.0-rc.*` с полностью другим CLI (без `generate`/`migrate dev`/`studio`). Ставить нужно версию, совпадающую с `@prisma/client` (сейчас `7.x`) — иначе `prisma migrate`/`generate` не заработают.

## Настройка

1. Скопировать `.env.example` в `.env` и заполнить:
   - `BOT_TOKEN` — токен бота от @BotFather
   - `DATABASE_URL` — строка подключения к Postgres
   - `MODERATOR_IDS` — Telegram ID модераторов через запятую
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

`.github/workflows/deploy.yml` при пуше в `main` собирает Docker-образ, пушит его в GHCR (`ghcr.io/<repo>:latest`) и по SSH разворачивает на сервере через `docker-compose.prod.yml` (Nest-приложение + Postgres в докере). Образ при старте контейнера сам накатывает миграции (`docker-entrypoint.sh` → `prisma migrate deploy`) перед запуском бота.

Что нужно на сервере и в секретах репозитория (Settings → Secrets and variables → Actions):

- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` — доступ по SSH к серверу.
- `DEPLOY_PATH` — директория на сервере с `docker-compose.prod.yml`.
- В `DEPLOY_PATH` на сервере вручную положить `.env` с `BOT_TOKEN` и `MODERATOR_IDS` (`DATABASE_URL` в проде уже задан в `docker-compose.prod.yml` и указывает на контейнер `db`).

Ручной прогон деплоя без пуша: вкладка Actions → workflow **Deploy** → Run workflow.
