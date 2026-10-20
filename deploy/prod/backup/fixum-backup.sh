#!/usr/bin/env bash
# Ежедневный бэкап базы прода (deploy/prod/SERVER.md, слой 6). Запускает fixum-backup.timer от root.
# pg_dump → проверка оглавления → шифрование age открытым ключом (секретный — только у администратора,
# на сервере его нет) → файл в приватный Telegram-канал отдельным ботом. Локально — последние KEEP копий,
# тоже зашифрованные. Любая ошибка — сообщение в тот же канал.
#
# Из /etc/fixum-backup.env (600): TG_TOKEN — бот бэкапов, TG_CHAT — id канала (-100…),
# AGE_RECIPIENT — открытый ключ age (age1…); TG_THREAD — номер темы, если TG_CHAT — группа с темами.
set -Eeuo pipefail
umask 077

: "${TG_TOKEN:?}" "${TG_CHAT:?}" "${AGE_RECIPIENT:?}"
PG=fixum_postgres
DB=fixum
DIR=/var/backups/fixum
KEEP=7

stamp="$(date -u +%Y%m%d-%H%M%S)"
plain="$DIR/${DB}_$stamp.dump"
file="$plain.age"

tg() {
  local thread=()
  [ -n "${TG_THREAD:-}" ] && thread=(-F message_thread_id="$TG_THREAD")
  curl -fsS -m 120 "https://api.telegram.org/bot$TG_TOKEN/$1" -F chat_id="$TG_CHAT" "${thread[@]}" "${@:2}" >/dev/null
}

# незашифрованный дамп на диске не оставляем ни при каком исходе
trap 'rm -f "$plain"' EXIT
trap 'tg sendMessage -F text="✗ бэкап $DB не удался: $(hostname), $stamp UTC, строка $LINENO" || true' ERR

mkdir -p "$DIR"
docker exec "$PG" pg_dump -Fc -U "$DB" -d "$DB" >"$plain"
test -s "$plain"
# оглавление читается — архив не битый (полноту доказывает только тестовое восстановление)
docker exec -i "$PG" pg_restore --list <"$plain" >/dev/null
age -r "$AGE_RECIPIENT" -o "$file" "$plain"

# ponytail: Bot API принимает файлы до 50 МБ — дорастёт база, слать частями (split) или в S3
tg sendDocument -F document=@"$file" \
  -F caption="✓ $DB $stamp UTC, $(du -h "$file" | cut -f1)"

ls -1t "$DIR/${DB}_"*.dump.age | tail -n +$((KEEP + 1)) | xargs -r rm -f
