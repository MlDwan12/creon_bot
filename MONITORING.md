# Мониторинг Fixum

Ошибки — в **Sentry**, метрики и алерты — в **Grafana Cloud**, итог выкатки — в Telegram.
Всё включается переменными окружения; без них код работает вхолостую и ничего никуда не отправляет.

Персональные данные наружу не уходят (сервисы зарубежные): в метриках только числа и шаблоны
маршрутов, в Sentry отключён сбор пользователя, заголовков, тел, параметров адреса, переменных
стектрейса и логов консоли (`src/monitoring/instrument.ts`, `webapp/src/monitoring.ts`).

## 1. Бот для алертов

Отдельный от Fixum: если сломается наш бот, алерт всё равно дойдёт.

1. @BotFather → `/newbot` → токен.
2. Чат для алертов: напишите боту что-нибудь (или добавьте его в группу) и узнайте `chat_id` через
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates`.

## 2. Sentry — ошибки

1. sentry.io → бесплатный тариф → два проекта: **Node.js** (бэкенд) и **Vue** (мини-апп).
2. DSN бэкенда → `SENTRY_DSN` в `/var/www/site/.env.creon_bot` на сервере.
3. DSN мини-аппа вшивается при сборке: GitHub → Settings → Secrets and variables → Actions →
   **Variables** → `VITE_SENTRY_DSN` (переменная репозитория — на оба стенда; это не секрет, он и так
   виден в браузере).
4. Проекты общие для прода и дева: стенд — в поле `environment` (домен мини-аппа: `fixumapp.com`,
   `dev.creon.couchreboot.site`), по нему фильтр в Issues и в правилах алертов.
5. Алерты Sentry: Alerts → «новая ошибка» с фильтром `environment:fixumapp.com` → в Telegram (через интеграцию или почту).

## 3. Grafana Cloud — метрики и алерты

1. grafana.com → бесплатный тариф → стек.
2. Стек → **OpenTelemetry** → Configure: адрес OTLP-шлюза (вида
   `https://otlp-gateway-prod-eu-west-2.grafana.net/otlp`), Instance ID и токен с правом `metrics:write`.
3. На сервере в `/var/www/site/.env.creon_bot`:
   ```
   GRAFANA_OTLP_URL=https://otlp-gateway-…/otlp
   GRAFANA_OTLP_INSTANCE_ID=…
   GRAFANA_OTLP_TOKEN=…
   ```
   Задаются все три или ни одного (иначе приложение не стартует — проверка в `env.validation.ts`).
4. Перезапуск сервиса: `sudo docker compose up -d --no-deps --force-recreate creon_bot`.
5. Через пару минут метрики `fixum_*` видны в Explore. Стенд — метка `instance` (домен мини-аппа):
   правила ниже смотрят только прод, `instance="fixumapp.com"`.
6. Дашборд: Dashboards → New → Import → файл `monitoring/grafana-dashboard.json`, источник — Prometheus стека.

### Проверка снаружи

Testing & synthetics → Synthetics → новая проверка **HTTP**: `https://fixumapp.com/api/health`,
раз в 5 минут, из 2 точек, ожидать 200. Срок SSL-сертификата проверка снимает сама.

### Метрики

Имена — как их показывает Grafana (точки → подчёркивания, у счётчиков `_total`); сверьте в Explore.

| Метрика | Что это |
|---|---|
| `fixum_http_requests_total{route,method,status}` | Запросы к API |
| `fixum_http_duration_ms_bucket{route}` | Время ответа |
| `fixum_bot_up` | 1 — бот получает сообщения (polling запущен и Telegram отвечает на getMe) |
| `fixum_notifications_queue_size` | Уведомлений в очереди |
| `fixum_notifications_oldest_age_seconds` | Сколько ждёт самое старое уведомление |
| `fixum_external_api_requests_total{platform,outcome}` | Запросы к API площадок: `ok` / `error` |
| `fixum_disk_free_ratio` | Свободная доля диска сервера |
| `fixum_memory_rss_bytes`, `fixum_memory_limit_bytes` | Память процесса и лимит контейнера |
| `fixum_event_loop_delay_p99_ms` | Задержка цикла событий Node |
| `fixum_business_count{kind}` | `orders_open`, `videos_on_review`, `payouts_requested` — для графиков |

### Точки доставки

Alerting → Contact points → два контакта типа **Telegram** с токеном и `chat_id` бота алертов:
- `telegram-loud` — обычный;
- `telegram-quiet` — с включённым **Disable notification** (без звука).

Notification policies: `severity=critical` → `telegram-loud`, `severity=warning` → `telegram-quiet`;
Repeat interval — 1 час (повтор, пока не починено). «Восстановилось» Grafana присылает сама.

### Правила алертов

Alerting → Alert rules → New. У каждого правила — метка `severity` и подсказка (Summary).

| Алерт | Запрос | Условие | severity | Что делать |
|---|---|---|---|---|
| Сайт недоступен | проверка Synthetics | 2 неудачи подряд | critical | `sudo docker ps` — жив ли `creon_bot`; `sudo docker logs --tail 100 creon_bot` |
| Бот не получает сообщения | `max(fixum_bot_up{instance="fixumapp.com"})` | `== 0` 5 мин | critical | Логи: 409 — второй экземпляр с тем же токеном; 401 — токен отозван; сеть до Telegram |
| Нет метрик от Fixum | `absent_over_time(fixum_bot_up{instance="fixumapp.com"}[5m])` | `== 1` | critical | Процесс упал или завис: `docker ps`, логи, перезапуск |
| Застряли уведомления | `max(fixum_notifications_oldest_age_seconds{instance="fixumapp.com"})` | `> 600` | critical | Логи `NotificationsService`: 429 от Telegram, сеть, бот заблокирован |
| Всплеск ошибок 500 | `sum(increase(fixum_http_requests_total{instance="fixumapp.com",status=~"5.."}[5m]))` | `>= 5` | critical | Sentry — какая ошибка и где |
| Мало места на диске | `min(fixum_disk_free_ratio{instance="fixumapp.com"})` | `< 0.15` | critical | `df -h`; старые образы — `docker image prune` (осторожно: сервер общий), дампы в `_backups` |
| Память у лимита | `max(fixum_memory_rss_bytes{instance="fixumapp.com"} / fixum_memory_limit_bytes{instance="fixumapp.com"})` | `> 0.85` 10 мин | warning | Поднять лимит в общем compose (256M → 512M) или искать утечку |
| API площадки сбоит | `sum by (platform) (increase(fixum_external_api_requests_total{instance="fixumapp.com",outcome="error"}[15m])) / sum by (platform) (increase(fixum_external_api_requests_total{instance="fixumapp.com"}[15m]))` | `> 0.5` | warning | Ключ или квота площадки; просмотры пока вводит модератор |
| SSL скоро истекает | `min(probe_ssl_earliest_cert_expiry) - time()` | `< 14 * 86400` | warning | `sudo certbot renew` на сервере |

## 4. Итог выкатки в Telegram

GitHub → Settings → Secrets and variables → Actions → **Repository secrets** (общие для обоих стендов):
`ALERT_BOT_TOKEN`, `ALERT_CHAT_ID` и,
если алерты идут в группу с темами, `ALERT_THREAD_ID` — номер темы проекта (без него — в общий чат).
После каждой выкатки: «✓ Fixum выкачен (прод)» / «(дев)» без звука или «✗ Выкатка … не удалась» со ссылкой
на лог. Без секретов шаг пропускается.

## 5. Дев-стенд

На деве — только Sentry: `SENTRY_DSN` в `/opt/creon/.env` (тот же DSN, что в проде; стенд различается по
`environment`), `GRAFANA_*` пустые — метрики дева не занимают лимит бесплатного Grafana Cloud. Проверить
метрики перед продом — временно задать `GRAFANA_*` и на деве: в Explore у них `instance="dev.creon.couchreboot.site"`.
Перезапуск после правки `.env`: `cd /opt/creon && docker compose up -d --no-deps --force-recreate creon_bot`.
