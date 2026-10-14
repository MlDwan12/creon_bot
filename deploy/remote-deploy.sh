#!/usr/bin/env bash
# Выкатка на сервере. Запускает .github/workflows/deploy.yml: кладёт этот файл в домашний каталог
# пользователя deploy и вызывает `ssh -n server "DIR=… bash remote-deploy.sh sha-<коммит>"`.
# Образ <APP>:sha-<коммит> к этому моменту уже загружен (`docker load`).
#
# Итог — только код возврата: 0 — новая версия запущена и healthy; иначе — ошибка (после отката,
# если он был возможен). stdin не используется вовсе: ssh -n, у compose — </dev/null.
#
# Сервис в compose всегда на теге <APP>:current, прошлая версия — <APP>:previous.
# Порядок: бэкап базы → current становится previous → новый образ становится current →
# up --force-recreate → ждём healthy именно нового образа. Не поднялся — откат на previous и
# проверка, что поднялся он. Миграции откат не отменяет — для этого бэкап до выкатки.
set -euo pipefail

TAG="${1:-}"
[[ "$TAG" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "тег — sha-<40 hex>, получено: '$TAG'" >&2; exit 2; }
: "${APP:?}" "${DIR:?}" "${SERVICE:?}" "${PG:?}" "${DB:?}" "${DB_USER:?}"
KEEP_BACKUPS=5
# start-period HEALTHCHECK в Dockerfile — 60 с на миграции; ждём с запасом
HEALTH_TRIES=36 # × 5 с

cd "$DIR"
mkdir -p _backups

compose() { docker compose "$@" </dev/null; }
image_id() { docker image inspect -f '{{.Id}}' "$1"; }

# Контейнер сервиса — на образе $1 и healthy. Проверяем образ: иначе healthy старого контейнера,
# который compose не пересоздал, сошёл бы за успешную выкатку.
wait_healthy() {
  local want="$1" running status
  for _ in $(seq "$HEALTH_TRIES"); do
    running="$(docker inspect -f '{{.Image}}' "$SERVICE" 2>/dev/null || true)"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$SERVICE" 2>/dev/null || true)"
    [ "$running" = "$want" ] && [ "$status" = healthy ] && return 0
    sleep 5
  done
  return 1
}

backup=""
rollback() {
  echo "✗ $1 — откат на previous" >&2
  compose logs --tail 80 "$SERVICE" >&2 || true
  if ! docker image inspect "$APP:previous" >/dev/null 2>&1; then
    echo "‼ предыдущей версии нет — стенд не восстановлен, нужен человек" >&2
    exit 1
  fi
  docker tag "$APP:previous" "$APP:current"
  if compose up -d --no-deps --force-recreate "$SERVICE" && wait_healthy "$(image_id "$APP:previous")"; then
    echo "Откат выполнен: работает предыдущая версия. Миграции, если успели примениться, остались; бэкап до них: $backup" >&2
  else
    echo "‼ откат тоже не поднялся — стенд лежит, нужен человек. Бэкап до выкатки: $backup" >&2
  fi
  exit 1
}

new_id="$(image_id "$APP:$TAG")"

echo "→ бэкап $DB"
backup="_backups/${DB}_$(date +%Y%m%d-%H%M%S)_before_${TAG:0:11}.dump"
compose exec -T "$PG" pg_dump -Fc -U "$DB_USER" -d "$DB" >"$backup"
test -s "$backup"
# оглавление читается — архив не битый (полноту доказывает только тестовое восстановление)
docker compose exec -T "$PG" pg_restore --list <"$backup" >/dev/null

if docker image inspect "$APP:current" >/dev/null 2>&1; then
  docker tag "$APP:current" "$APP:previous"
fi
docker tag "$APP:$TAG" "$APP:current"

echo "→ запуск $SERVICE"
compose up -d --no-deps --force-recreate "$SERVICE" || rollback "docker compose up завершился ошибкой"
wait_healthy "$new_id" || rollback "новая версия не стала healthy за $((HEALTH_TRIES * 5)) с"

echo "→ уборка: остаются current и previous, последние $KEEP_BACKUPS бэкапов"
docker rmi "$APP:$TAG" >/dev/null # тег сборки; сам образ остаётся под current
# только образы этого приложения (LABEL в Dockerfile): висячие образы соседних проектов не трогаем
docker image prune -f --filter "label=app=$APP" >/dev/null
# только свои бэкапы (по имени базы): /var/www/site общий, чужие дампы в _backups не трогаем
ls -1t "_backups/${DB}_"*.dump | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

echo "✓ выкачено $TAG"
