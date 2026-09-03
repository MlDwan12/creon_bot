# Деплой

Пуш в `main` гоняет `CI` (typecheck/lint/test/build), затем `Deploy`: собирает
Docker-образ, пушит в `ghcr.io/<owner>/<repo>`, по SSH заходит на VPS,
подтягивает свежий образ и перезапускает контейнеры (`docker-compose.prod.yml`).
Миграции (`prisma migrate deploy`) применяются автоматически при старте
контейнера бота — руками катить не нужно.

## Секреты репозитория (Settings → Secrets and variables → Actions)

| Secret            | Значение                                                |
| ------------------ | -------------------------------------------------------- |
| `SSH_HOST`         | IP или домен VPS                                          |
| `SSH_USER`          | пользователь для SSH (например, `deploy`)                 |
| `SSH_PRIVATE_KEY`   | приватный ключ (без пароля) для этого пользователя         |
| `DEPLOY_PATH`       | путь на VPS с `docker-compose.prod.yml` и `.env`, например `/opt/creon_bot` |

`GITHUB_TOKEN` передавать не нужно — GitHub создаёт его автоматически на каждый запуск воркфлоу.

## Разовая настройка VPS

1. Поставить Docker + Docker Compose plugin (`curl -fsSL https://get.docker.com | sh`).
2. Создать пользователя для деплоя, добавить в группу `docker`, прописать его публичный ключ в `~/.ssh/authorized_keys`.
3. Создать каталог деплоя (должен совпадать с `DEPLOY_PATH`):
   ```bash
   mkdir -p /opt/creon_bot && cd /opt/creon_bot
   ```
4. Положить туда `docker-compose.prod.yml` из репозитория (просто скопировать файл — репозиторий на сервере клонировать не нужно).
5. Создать `.env` рядом с ним:
   ```
   BOT_TOKEN=<боевой токен от @BotFather>
   MODERATOR_IDS=<id модераторов через запятую>
   ```
   `DATABASE_URL` сюда не класть — он задаётся автоматически в `docker-compose.prod.yml` (контейнер бота стучится в контейнер `db` по внутренней docker-сети).
6. Первый прогон (пока ещё нет пуша в `main`, который создаст образ) можно сделать руками:
   ```bash
   docker login ghcr.io -u <github-username>
   GITHUB_REPOSITORY=<owner>/<repo> docker compose -f docker-compose.prod.yml pull
   GITHUB_REPOSITORY=<owner>/<repo> docker compose -f docker-compose.prod.yml up -d
   ```
   Дальше это делает воркфлоу `Deploy` при каждом пуше в `main`.

## Пакет ghcr.io

По умолчанию образ приватный (репозиторий приватный). Воркфлоу `Deploy` сам
логинится на VPS через `GITHUB_TOKEN` перед `pull`, отдельно ничего делать не
нужно.
