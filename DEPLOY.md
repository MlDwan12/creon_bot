# Деплой

Прод выкатывает GitHub Actions: мерж в `main` → зелёный CI → `.github/workflows/deploy.yml` собирает образ и по SSH
выкатывает его на сервер. На сервер ничего не ставится: все шаги — в workflow.

## Как устроен прод

- VPS `72.60.80.75`, каталог `/var/www/site`. Там общий `docker-compose.yaml` с другим проектом (vituss) —
  ничего, кроме сервиса `creon_bot`, не трогаем.
- База — общий сервис `postgres` (postgres 15), у бота своя роль `creon` (не суперпользователь) и база `creon_bot`.
- nginx и certbot стоят на хосте: `/etc/nginx/sites-available/fixumapp.com` (+ www) → `127.0.0.1:8003`.
  `frame-ancestors` и `X-Frame-Options` в vhost не добавлять: Telegram Web открывает Mini App во фрейме.
- Миграции накатываются сами при старте контейнера (`docker-entrypoint.sh` → `prisma migrate deploy`).
- `HEALTHCHECK` образа дёргает `/api/health`, статус виден в `docker ps`.

Сервис в общем compose:

```yaml
creon_bot:
  <<: *default-logging
  image: creon_bot:current
  pull_policy: never
  container_name: creon_bot
  restart: always
  env_file:
    - .env.creon_bot
  ports:
    - '127.0.0.1:8003:3000'
  depends_on:
    postgres:
      condition: service_healthy
  deploy:
    resources:
      limits:
        memory: 256M
      reservations:
        memory: 128M
  networks:
    - backend
```

В `.env.creon_bot` (права 600) — переменные из `.env.example`; `DATABASE_URL=postgresql://creon:<пароль>@postgres:5432/creon_bot`.
`BOT_TOKEN` — боевой: long polling, один токен опрашивает только один процесс.

## Как идёт выкатка

`.github/workflows/deploy.yml` (права токена — только `contents: read`):
1. запускается только после зелёного CI на пуше в `main` этого репозитория (не форка);
2. если коммит уже не вершина `main` (CI нового коммита закончился раньше), выкатку пропускает — иначе стенд откатился бы на старую версию;
3. собирает образ `creon_bot:sha-<коммит>` из того коммита, что прошёл CI; SSH-ключ появляется на раннере только после сборки;
4. по SSH: `docker load` образа и копия `deploy/remote-deploy.sh` в домашний каталог `deploy`, затем `ssh -n prod … bash remote-deploy.sh <тег>`. Итог — только код возврата скрипта.

`deploy/remote-deploy.sh` на сервере:
1. бэкап базы `pg_dump -Fc` в `/var/www/site/_backups/creon_bot_*.dump` (последние 5; чужие файлы в папке не трогаются) и проверка, что архив читается (`pg_restore --list`);
2. текущий `creon_bot:current` становится `creon_bot:previous`, новый образ — `current`;
3. `docker compose up -d --no-deps --force-recreate creon_bot` и ждёт до 3 минут, пока контейнер **на новом образе** станет `healthy`;
4. упал `up` или нет healthy — откат на `previous` и проверка, что healthy стал он; job красный в обоих случаях, в логе — получилось ли откатиться;
5. удаляет тег сборки и висячие образы creon (по метке `app=creon_bot`), чужие не трогает.

Откат образа **не откатывает миграции**. Поэтому миграции — только совместимые с прошлой версией кода: сначала добавить (колонку, таблицу), выпустить код, который работает с обеими схемами, и только следующим релизом удалять старое (expand → contract).

Откат вручную: `sudo docker tag creon_bot:previous creon_bot:current && sudo docker compose up -d --no-deps --force-recreate creon_bot`.

Восстановление базы из бэкапа (бот остановлен, чтобы не писал в базу; всё или ничего — `--single-transaction`):

```bash
cd /var/www/site
sudo docker compose stop creon_bot
sudo sh -c 'cat _backups/<файл>.dump' | sudo docker compose exec -T postgres \
  pg_restore -U creon -d creon_bot --clean --if-exists --no-owner --single-transaction --exit-on-error
sudo docker compose up -d --no-deps creon_bot
```

## Настройка (один раз)

1. На сервере — пользователь для CI в группе `docker`, без пароля и sudo:
   ```bash
   sudo useradd -m -s /bin/bash -G docker deploy
   sudo passwd -l deploy
   ```
   Группа `docker` — это фактически root на сервере, включая контейнеры соседнего проекта: ключ храним только
   в секретах GitHub.
2. Ключ — на своей машине: `ssh-keygen -t ed25519 -f creon_deploy -N '' -C creon-ci`.
   Публичный (`creon_deploy.pub`) — в `/home/deploy/.ssh/authorized_keys` (каталог 700, файл 600, владелец deploy).
3. Проверка со своей машины: `ssh -i creon_deploy deploy@72.60.80.75 docker ps` — список контейнеров.
4. GitHub → Settings → Environments → `production`, секреты:

   | Секрет | Значение |
   |---|---|
   | `SSH_HOST` | `72.60.80.75` |
   | `SSH_PORT` | `22` (или свой) |
   | `SSH_USER` | `deploy` |
   | `SSH_KEY` | содержимое приватного `creon_deploy` целиком, с первой и последней строкой |
   | `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan -p <порт> 72.60.80.75` со своей машины |

   По желанию там же — Required reviewers: выкатка ждёт подтверждения. После этого `creon_deploy` удалить с машины.

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
