# Прод-сервер Fixum: настройка с нуля

Отдельный VPS только под Fixum (Hostinger, Ubuntu 24.04 LTS, 2 vCPU, 8 ГБ RAM, 96 ГБ диск), `fixum-prod`,
IPv4 `72.62.46.36`. Здесь — всё, что сделано на сервере руками, по слоям: по этому файлу сервер поднимается
заново. Секретов в файле нет; порт SSH — тоже не здесь, он в `~/.ssh/config` администратора
и в менеджере паролей (дальше — `<SSH_PORT>`).

Слои: 1 — базовая защита · 2 — Docker и пользователь выкатки · 3 — приложение · 4 — вход снаружи (HTTPS) ·
5 — выкатка из GitHub · 6 — бэкапы · 7 — наблюдение.

## Слой 1. Базовая защита

Итог: вход только по SSH-ключу и только пользователем `ops`, root по SSH не входит, пароли по SSH
не принимаются; снаружи открыты только `<SSH_PORT>`, 80 и 443; fail2ban банит перебор; обновления
безопасности ставятся сами, перезагрузка для ядра — в 04:00 UTC; часы — UTC; swap 2 ГБ.

### 1.1. Ключ администратора (на ноутбуке)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fixum_prod -C "fixum-prod-admin"   # passphrase — в менеджер паролей, вводить вставкой
```

### 1.2. Система и пользователь (под root, по паролю из панели — в последний раз)

```bash
apt update && apt full-upgrade -y
timedatectl set-timezone UTC
hostnamectl set-hostname fixum-prod
adduser --gecos "" ops            # пароль — для sudo, в менеджер паролей
usermod -aG sudo ops
reboot                            # если обновилось ядро
```

### 1.3. Ключ на сервер (на ноутбуке)

```bash
ssh-copy-id -i ~/.ssh/fixum_prod.pub ops@72.62.46.36
ssh -t -o IdentitiesOnly=yes -o PasswordAuthentication=no -i ~/.ssh/fixum_prod ops@72.62.46.36 'sudo -v && echo OK'
```

Отпечаток ключа сервера при первом подключении сверить с выводом в браузерном терминале панели
(`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`): ED25519 `SHA256:SPWt8APqa1XCbqQ0MhN/ufN4Pzs/z1UNb+JStiqzNn8`.

`~/.ssh/config` на ноутбуке — вход командой `ssh fixum-prod`:

```
Host fixum-prod
  HostName 72.62.46.36
  Port <SSH_PORT>
  User ops
  IdentityFile ~/.ssh/fixum_prod
  IdentitiesOnly yes
```

### 1.4. SSH: только ключ, только ops

Файл `10-…` — раньше `50-cloud-init.conf` (там `PasswordAuthentication yes`): в sshd побеждает первое значение.

```bash
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
# Вход только по ключу и только для ops; root не входит
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
AllowUsers ops
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
sudo sshd -t && sudo systemctl restart ssh
```

Проверка с ноутбука, не закрывая текущую сессию: `ssh fixum-prod 'echo OK'` пускает;
`ssh -o PubkeyAuthentication=no root@72.62.46.36` и то же для `ops` — сразу `Permission denied (publickey)`.

### 1.5. Файрвол и порт SSH

Нестандартный порт — от шума в логах, не защита (защита — ключ). В Ubuntu 24.04 SSH запускается через
`ssh.socket`: `Port` из `sshd_config` переносит в сокет генератор после `daemon-reload`.
Порядок — чтобы не потерять доступ: открыть новый порт → проверить вход → закрыть 22.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow <SSH_PORT>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
echo 'Port <SSH_PORT>' | sudo tee /etc/ssh/sshd_config.d/05-port.conf
sudo sshd -t && sudo systemctl daemon-reload && sudo systemctl restart ssh.socket
# с ноутбука: ssh -p <SSH_PORT> fixum-prod 'echo OK' — и только потом:
sudo ufw delete allow 22/tcp
```

Docker публикует порты в обход ufw — поэтому порты контейнеров только на `127.0.0.1` (слой 3).

### 1.6. fail2ban

```bash
sudo apt install -y fail2ban python3-systemd
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
# Бан IP на час после 5 неудачных входов за 10 минут; журнал sshd — из systemd
[sshd]
enabled = true
port = <SSH_PORT>
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
sudo systemctl enable fail2ban && sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
sudo fail2ban-regex systemd-journal sshd | grep -E '^(Lines|Failregex):'   # фильтр видит отказы во входе
```

`port` — обязательно: без него бан закрывает 22, а не наш порт. Проверять бан «вживую» со своего IP не надо —
заблокирует на час.

Повторные нарушители — на неделю и на все порты:

```bash
sudo tee /etc/fail2ban/jail.d/recidive.local >/dev/null <<'EOF'
# Повторные нарушители: 3 бана за сутки — бан на неделю на все порты
[recidive]
enabled = true
backend = auto
logpath = /var/log/fail2ban.log
findtime = 1d
bantime = 1w
maxretry = 3
EOF
sudo systemctl restart fail2ban && sudo fail2ban-client status   # Jail list: recidive, sshd
```

Сканеры закрытых портов fail2ban не касаются: ufw молча отбрасывает пакеты, за портами ничего нет.
Сканеры и флуд сайта — слой 4 (nginx: `444` на чужой Host, `limit_req`, jails `nginx-botsearch`/`nginx-limit-req`).

### 1.7. Обновления безопасности

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo tee /etc/apt/apt.conf.d/52fixum-upgrades >/dev/null <<'EOF'
// Обновления безопасности ставятся сами; если нужна перезагрузка (ядро) — ночью.
// Контейнеры поднимутся сами (restart: always).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
```

Переход на следующую LTS (`do-release-upgrade`) — только планово, после проверки на деве.

### 1.8. Swap

Подушка от OOM: без swap при всплеске памяти ядро сразу убивает самый крупный процесс — обычно Postgres.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system
```

### 1.9. Снапшот

Панель Hostinger → VPS → Snapshots & Backups → снапшот «слой 1» — точка отката перед Docker.

## Слой 2. Docker и пользователь выкатки

### 2.1. Docker

Из официального репозитория Docker (в Ubuntu — старые версии). Отпечаток ключа сверить:
`9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
gpg --show-keys /etc/apt/keyrings/docker.asc        # отпечаток — как выше
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
echo 'Acquire::Retries "3";' | sudo tee /etc/apt/apt.conf.d/80-retries   # разовые сбои зеркал
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true,
  "no-new-privileges": true
}
JSON
sudo systemctl restart docker
sudo docker run --rm hello-world | grep 'Hello from Docker'
sudo docker info --format 'logs={{.LoggingDriver}} live-restore={{.LiveRestoreEnabled}} security={{.SecurityOptions}}'
```

Логи контейнеров — не больше 30 МБ на контейнер; `live-restore` — перезапуск/обновление dockerd не роняет
контейнеры; `no-new-privileges` — процесс в контейнере не поднимет права через setuid.

### 2.2. Пользователь `deploy`

От его имени GitHub Actions выкатывает приложение (`docker load`, `scp`, `remote-deploy.sh`). Без пароля
и sudo, вход только по своему ключу (без passphrase — для CI; приватная часть — только в секрете
environment `production`). Группа `docker` по сути равна root — поэтому каждую выкатку в прод
подтверждает человек (required reviewers, слой 5). `restrict` в `authorized_keys` — без проброса портов,
агента и терминала; одну команду (`command=`) задать нельзя: workflow выполняет три разные.

На ноутбуке:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fixum_prod_deploy -C "github-deploy-fixum-prod"   # passphrase пустая
```

На сервере:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo sed -i 's/^AllowUsers ops$/AllowUsers ops deploy/' /etc/ssh/sshd_config.d/10-hardening.conf
sudo sshd -t && sudo systemctl restart ssh
```

Ключ — с ноутбука:

```bash
ssh -t fixum-prod "echo 'restrict $(cat ~/.ssh/fixum_prod_deploy.pub)' | sudo tee /home/deploy/.ssh/authorized_keys >/dev/null && sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys"
```

Проверка с ноутбука (`D='ssh -i ~/.ssh/fixum_prod_deploy -o IdentitiesOnly=yes -p <SSH_PORT> deploy@72.62.46.36'`):
`$D 'id && docker ps'` — группа `docker`, пустая таблица; `$D 'sudo -n true'` — `a password is required`;
`$D -o ExitOnForwardFailure=yes -R 15432:127.0.0.1:22 'echo x'` — `remote port forwarding failed`.

Отзыв ключа (утёк): очистить `/home/deploy/.ssh/authorized_keys`, выпустить новый, обновить секрет в GitHub.

### 2.3. Снапшот

Панель Hostinger → снапшот «слой 2».

## Слой 3. Приложение

`/opt/fixum` (владелец `deploy`, 750): `docker-compose.yml` из `deploy/prod/` и `.env` (600). Postgres 17
без опубликованного порта, бот — только на `127.0.0.1:3000` (для nginx). Образ бота привозит выкатка
(слой 5) — до неё стоит только база. `ops` в `/opt/fixum` не заходит: compose — от `deploy` с `-f`.

```bash
sudo install -d -m 750 -o deploy -g deploy /opt/fixum
# с ноутбука, из корня репозитория:
scp -i ~/.ssh/fixum_prod_deploy -o IdentitiesOnly=yes -P <SSH_PORT> deploy/prod/docker-compose.yml deploy@72.62.46.36:/opt/fixum/
```

`.env` — пароль базы генерируется на сервере и не выводится (hex — без экранирования в `DATABASE_URL`):

```bash
PW=$(openssl rand -hex 24)
sudo -u deploy sh -c 'umask 077 && cat > /opt/fixum/.env' <<ENV
POSTGRES_PASSWORD=$PW
DATABASE_URL=postgresql://fixum:$PW@postgres:5432/fixum
WEBAPP_URL=https://fixumapp.com
ENV
unset PW
sudo -u deploy nano /opt/fixum/.env   # остальные ключи — по .env.example
```

Секреты при переезде: `BOT_TOKEN` — новый (`/revoke` в BotFather в момент переключения: старый сервер
больше не опросит Telegram); ключи API площадок — новые; `MODERATOR_IDS`, `SUPPORT_CHAT_ID`,
`PLATFORM_FEE_PERCENT` — как были. `SOCIAL_TOKENS_KEY` на старом сервере не было (TikTok/VK/Instagram
не подключены) — задать при подключении площадок: `openssl rand -base64 32`. Потом не менять: им
зашифрованы токены подключённых аккаунтов, смена отключает их все.

```bash
cd / && sudo -u deploy docker compose -f /opt/fixum/docker-compose.yml up -d postgres
sudo docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'   # fixum_postgres … (healthy) 5432/tcp — без 0.0.0.0
```
