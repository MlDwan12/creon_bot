# Деплой

Прод выкатывает GitHub Actions: мерж в `main` → зелёный CI → `.github/workflows/deploy.yml` собирает образ и по SSH
выкатывает его на сервер. На сервер ничего не ставится: все шаги — в workflow.

## Как устроен прод

- Свой VPS (Hostinger) `72.62.46.36`, только под Fixum; настройка сервера по слоям — `deploy/prod/SERVER.md`.
- Каталог `/opt/fixum` (владелец `deploy`): `docker-compose.yml` из `deploy/prod/` и `.env` (600) — переменные
  из `.env.example`, `DATABASE_URL=postgresql://fixum:<пароль>@postgres:5432/fixum`.
- База — свой Postgres 17 в том же compose, порт наружу не публикуется. Бот — контейнер `fixum_bot` на `127.0.0.1:3000`.
- nginx и certbot на хосте: `deploy/prod/nginx/` → `/etc/nginx/sites-available/`.
  `frame-ancestors` и `X-Frame-Options` в vhost не добавлять: Telegram Web открывает Mini App во фрейме.
- Миграции накатываются сами при старте контейнера (`docker-entrypoint.sh` → `prisma migrate deploy`).
- `HEALTHCHECK` образа дёргает `/api/health`, статус виден в `docker ps`.
- `BOT_TOKEN` — боевой: long polling, один токен опрашивает только один процесс.

## Как идёт выкатка

`.github/workflows/deploy.yml` (права токена — только `contents: read`):
1. запускается только после зелёного CI на пуше в `main` этого репозитория (не форка);
2. если коммит уже не вершина `main` (CI нового коммита закончился раньше), выкатку пропускает — иначе стенд откатился бы на старую версию;
3. собирает образ `creon_bot:sha-<коммит>` из того коммита, что прошёл CI; SSH-ключ появляется на раннере только после сборки;
4. по SSH: `docker load` образа и копия `deploy/remote-deploy.sh` в домашний каталог `deploy`, затем `ssh -n prod … bash remote-deploy.sh <тег>`. Итог — только код возврата скрипта.

`deploy/remote-deploy.sh` на сервере:
1. бэкап базы `pg_dump -Fc` в `/opt/fixum/_backups/fixum_*.dump` (последние 5) и проверка, что архив читается (`pg_restore --list`);
2. текущий `creon_bot:current` становится `creon_bot:previous`, новый образ — `current`;
3. `docker compose up -d --no-deps --force-recreate fixum_bot` и ждёт до 3 минут, пока контейнер **на новом образе** станет `healthy`;
4. упал `up` или нет healthy — откат на `previous` и проверка, что healthy стал он; job красный в обоих случаях, в логе — получилось ли откатиться;
5. удаляет тег сборки и висячие образы creon (по метке `app=creon_bot`), чужие не трогает.

Откат образа **не откатывает миграции**. Поэтому миграции — только совместимые с прошлой версией кода: сначала добавить (колонку, таблицу), выпустить код, который работает с обеими схемами, и только следующим релизом удалять старое (expand → contract).

Откат вручную (на сервере, под `ops`): `sudo docker tag creon_bot:previous creon_bot:current && sudo -u deploy docker compose -f /opt/fixum/docker-compose.yml up -d --no-deps --force-recreate fixum_bot`.

Восстановление базы из бэкапа (бот остановлен, чтобы не писал в базу; всё или ничего — `--single-transaction`):

```bash
C='sudo -u deploy docker compose -f /opt/fixum/docker-compose.yml'
$C stop fixum_bot
sudo cat /opt/fixum/_backups/<файл>.dump | $C exec -T postgres \
  pg_restore -U fixum -d fixum --clean --if-exists --no-owner --single-transaction --exit-on-error
$C up -d --no-deps fixum_bot
```

## Настройка (один раз)

Пользователь `deploy` и его ключ — `deploy/prod/SERVER.md`, слой 2.2. GitHub → Settings → Environments →
`production`, секреты:

| Секрет | Значение |
|---|---|
| `SSH_HOST` | `72.62.46.36` |
| `SSH_PORT` | порт SSH сервера (в `~/.ssh/config` администратора) |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | содержимое приватного `~/.ssh/fixum_prod_deploy` целиком, с первой и последней строкой |
| `SSH_KNOWN_HOSTS` | `ssh-keyscan -p <порт> -t ed25519 72.62.46.36`; отпечаток сверить с `SERVER.md` |

Там же — Required reviewers: каждая выкатка в прод ждёт подтверждения.

## Дев-стенд

Тот же `deploy.yml`: зелёный CI на пуше в `develop` (мерж PR) → выкатка на дев-стенд, GitHub environment `dev`.
Workflow с `workflow_run` берётся из `main`: правки `deploy.yml` начинают действовать только после попадания в `main`.

- VPS `38.180.145.13`, только наш. Каталог `/opt/creon`: `docker-compose.yml` из `deploy/dev/` и `.env` (права 600).
- База — свой `postgres` в том же compose (том `db_data`), бэкапы перед выкаткой — в `/opt/creon/_backups`.
- nginx и certbot на хосте: `/etc/nginx/sites-available/dev.creon.couchreboot.site` → `127.0.0.1:3000`.
- Бот — тестовый `@creontest_bot` (свой токен, иначе 409 с продом). Группа поддержки и модераторы — как в проде.

Настройка (один раз, под root):

```bash
useradd -m -s /bin/bash -G docker deploy && usermod -p '*' deploy   # без пароля; passwd -l не годится — sshd не пустит
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh /opt/creon
# сюда — публичный ключ: ssh-keygen -t ed25519 -f creon_dev_deploy -N "" -C creon-ci-dev (на своей машине)
nano /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
# в /opt/creon — docker-compose.yml из deploy/dev/ и .env по .env.example, плюс:
#   POSTGRES_PASSWORD=<openssl rand -hex 24>
#   DATABASE_URL=postgresql://creon:<тот же пароль>@postgres:5432/creon_bot
#   WEBAPP_URL=https://dev.creon.couchreboot.site
chown deploy:deploy /opt/creon/* && chmod 600 /opt/creon/.env
cd /opt/creon && docker compose up -d postgres
```

GitHub → Settings → Environments → `dev`: те же секреты `SSH_*`, что у `production`, но для `38.180.145.13`
(ключ — отдельный, `creon_dev_deploy`). `ALERT_*` — по желанию, в сообщении будет «дев».
