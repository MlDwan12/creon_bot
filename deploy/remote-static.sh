#!/usr/bin/env bash
# Выкладка статики (мини-апп, сайт) на сервере. Запускает .github/workflows/deploy.yml: кладёт этот файл и
# архив сборки static-<коммит>.tar.gz в домашний каталог deploy и вызывает
# `ssh -n server "WEB_DIR=… bash remote-static.sh <коммит>"`.
#
# Версии — в $WEB_DIR/releases/<коммит>, nginx отдаёт $WEB_DIR/current — симлинк на одну из них.
# Переключение атомарное (mv -T поверх симлинка): запрос видит либо старую сборку, либо новую.
# Откат — вернуть симлинк на прошлую версию (DEPLOY.md). Бот и база не затрагиваются.
set -euo pipefail

SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "коммит — 40 hex, получено: '$SHA'" >&2; exit 2; }
: "${WEB_DIR:?}"
KEEP=5
archive="$HOME/static-$SHA.tar.gz"

[ -w "$WEB_DIR" ] || { echo "‼ нет папки $WEB_DIR или прав на запись — разовая настройка в DEPLOY.md" >&2; exit 1; }
cd "$WEB_DIR"
mkdir -p releases

rel="releases/$SHA"
rm -rf "$rel.tmp" && mkdir "$rel.tmp"
tar -xzf "$archive" -C "$rel.tmp"
test -s "$rel.tmp/index.html" || { echo "‼ в архиве нет index.html" >&2; exit 1; }
# nginx читает от своего пользователя
chmod -R a+rX "$rel.tmp"
rm -rf "$rel" && mv "$rel.tmp" "$rel"
# время папки — время выкладки (tar ставит время из архива), по нему ниже — какие версии старые
touch "$rel"

ln -sfn "$rel" current.tmp && mv -T current.tmp current
rm -f "$archive"

# старые версии — кроме KEEP последних и той, на которую смотрит current
# (grep без совпадений — код 1: при pipefail это не ошибка выкладки)
ls -1dt releases/*/ | sed 's#/$##' | tail -n +$((KEEP + 1)) | { grep -vx "$(readlink current)" || true; } | xargs -r rm -rf

echo "✓ статика $SHA в $WEB_DIR/current"
