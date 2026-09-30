# Деплой

Прод деплоится вручную: образ собирается локально и загружается на VPS. Автодеплоя нет, пуш в `main` только прогоняет CI.

## Как устроен прод

- VPS, каталог `/var/www/site`. Там общий `docker-compose.yaml` с другими проектами. Бот — сервис `creon_bot`.
- База — общий сервис `postgres:17` в сети `backend`. Отдельного контейнера БД у бота нет.
- nginx и certbot стоят на хосте (`/etc/nginx/sites-enabled`). Mini App — `https://creon.couchreboot.site` → `127.0.0.1:8003`.
  `frame-ancestors` и `X-Frame-Options` в vhost не добавлять: Telegram Web открывает Mini App во фрейме.
- Миграции накатываются сами при старте контейнера (`docker-entrypoint.sh` → `prisma migrate deploy`).
- `HEALTHCHECK` образа дёргает `/api/health`, статус виден в `docker ps`.

Сервис в общем compose:

```yaml
creon_bot:
  image: creon_bot:<дата>-<N>
  restart: unless-stopped
  env_file: ./.env.creon_bot
  mem_limit: 256m
  ports:
    - 127.0.0.1:8003:3000
  networks:
    - backend
```

В `.env.creon_bot` — переменные из `.env.example`. `DATABASE_URL` указывает на сервис postgres общего compose. `BOT_TOKEN` — боевой: бот работает через long polling, и один токен может опрашивать только один процесс.

## Выкатка

1. Перед релизом с миграциями сделать бэкап базы (`pg_dump` из контейнера postgres).
2. Собрать образ локально из нужного коммита и сохранить в файл:
   ```bash
   docker build -t creon_bot:<дата>-<N> .
   docker save creon_bot:<дата>-<N> | gzip > creon_bot_<дата>-<N>.tar.gz
   ```
3. Загрузить архив в `/var/www/site/_images/` (SFTP).
4. На сервере:
   ```bash
   cd /var/www/site
   sudo docker load < _images/creon_bot_<дата>-<N>.tar.gz
   # поменять тег образа у сервиса creon_bot в docker-compose.yaml
   sudo docker compose up -d --no-deps creon_bot
   sudo docker compose logs -f creon_bot   # миграции и старт бота
   ```

Откат — вернуть в compose прошлый тег и снова `up -d --no-deps creon_bot`. Если релиз применил миграции, откат кода их не отменит: для возврата схемы нужен бэкап.
