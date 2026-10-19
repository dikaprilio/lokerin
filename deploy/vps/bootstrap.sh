#!/usr/bin/env bash
# Pemasangan sekali di VPS IDCloudHost (Ubuntu 24.04). Aman dijalankan ulang.
#
#   scp -r deploy/vps lokerin@<ip>:/tmp/lokerin-vps
#   ssh -t lokerin@<ip> sudo bash /tmp/lokerin-vps/bootstrap.sh "<kunci publik deploy>"
#
# Yang dipasang: user deploy (kunci dengan forced command), SSH hanya kunci, ufw, fail2ban,
# unattended-upgrades, swap, Docker, Caddy, Postgres 18 + PostGIS + pgvector, backup harian,
# unit systemd, dan /etc/lokerin/backend.env (dibuat sekali, tidak pernah ditimpa).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo" >&2; exit 1; }
KUNCI_DEPLOY="${1:-}"
case "$KUNCI_DEPLOY" in ssh-ed25519\ *) ;; *) echo "Argumen pertama: kunci publik ed25519 untuk deploy" >&2; exit 1 ;; esac

SINI="$(cd "$(dirname "$0")" && pwd)"
ADMIN="${SUDO_USER:-lokerin}"
PG=18
export DEBIAN_FRONTEND=noninteractive

langkah() { printf '\n== %s\n' "$*"; }

langkah "Paket dasar"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

langkah "Pembaruan keamanan otomatis"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

langkah "Swap 2 GB"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/90-lokerin.conf

langkah "Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io
fi
# Log container dibatasi agar disk 40 GB tidak penuh.
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "3" } }
EOF
systemctl restart docker

langkah "Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi
install -m 644 "$SINI/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

langkah "Postgres $PG + PostGIS + pgvector"
if [ ! -d "/usr/lib/postgresql/$PG" ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -yq "postgresql-$PG" "postgresql-$PG-postgis-3" "postgresql-$PG-pgvector"
fi
# Hanya localhost: API memakai jaringan host, jadi tidak ada port Postgres yang terbuka.
cat > "/etc/postgresql/$PG/main/conf.d/lokerin.conf" <<'EOF'
listen_addresses = 'localhost'
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 8MB
maintenance_work_mem = 128MB
max_connections = 50
EOF
systemctl restart postgresql

langkah "Berkas env backend"
install -d -m 750 -o root -g root /etc/lokerin
if ! id deploy >/dev/null 2>&1; then useradd --create-home --shell /bin/bash deploy; fi
usermod -aG docker deploy
chgrp deploy /etc/lokerin
ENV=/etc/lokerin/backend.env
if [ ! -f "$ENV" ]; then
  SANDI_DB="$(openssl rand -hex 24)"
  umask 077
  cat > "$ENV" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://lokerin:$SANDI_DB@127.0.0.1:5432/lokerin
DATABASE_URL_UNPOOLED=postgres://lokerin:$SANDI_DB@127.0.0.1:5432/lokerin
SESSION_SECRET=$(openssl rand -hex 32)
FRONTEND_ORIGINS=https://lokerin.site,https://app.lokerin.site
PUBLIC_WEB_URL=https://app.lokerin.site
# Isi sisanya dari .env.example: GOOGLE_CLIENT_IDS, MAPBOX_SECRET_TOKEN, VAPID_*, OPENROUTER_*, OPENAI_*, LIVE_*
EOF
  umask 022
fi
chown root:deploy "$ENV"
chmod 640 "$ENV"
SANDI_DB="$(sed -nE 's#^DATABASE_URL=postgres://lokerin:([^@]+)@.*#\1#p' "$ENV")"

langkah "Database lokerin"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<EOF
SELECT 'CREATE ROLE lokerin LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lokerin') \gexec
ALTER ROLE lokerin PASSWORD '$SANDI_DB';
SELECT 'CREATE DATABASE lokerin OWNER lokerin' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lokerin') \gexec
EOF
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d lokerin -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector; ALTER SCHEMA public OWNER TO lokerin;"

langkah "Backup harian"
install -d -m 750 -o postgres -g postgres /var/backups/lokerin
install -m 755 "$SINI/backup.sh" /usr/local/bin/lokerin-backup
cat > /etc/cron.d/lokerin-backup <<'EOF'
# 20.15 UTC = 03.15 WIB setiap hari. Skripnya menyimpan 14 hari terakhir.
15 20 * * * postgres /usr/local/bin/lokerin-backup
EOF

langkah "Unit systemd dan skrip deploy"
install -m 644 "$SINI/lokerin-backend.service" /etc/systemd/system/lokerin-backend.service
# Milik root dan tidak bisa ditulis deploy: kunci deploy hanya boleh menjalankan skrip ini apa adanya.
install -m 755 -o root -g root "$SINI/deploy.sh" /usr/local/bin/lokerin-deploy
cat > /etc/sudoers.d/lokerin-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart lokerin-backend, /usr/bin/systemctl stop lokerin-backend, /usr/bin/journalctl -u lokerin-backend *
EOF
chmod 440 /etc/sudoers.d/lokerin-deploy
visudo -cq
systemctl daemon-reload
systemctl enable lokerin-backend >/dev/null

langkah "Kunci deploy (forced command)"
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "command=\"/usr/local/bin/lokerin-deploy\",restrict $KUNCI_DEPLOY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

langkah "SSH: hanya kunci, tanpa root"
[ -s "/home/$ADMIN/.ssh/authorized_keys" ] || { echo "$ADMIN belum punya authorized_keys, SSH tidak diubah agar tidak terkunci" >&2; exit 1; }
# Nama 00- supaya menang dari 50-cloud-init.conf (sshd memakai nilai pertama yang ditemukan).
cat > /etc/ssh/sshd_config.d/00-lokerin.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers $ADMIN deploy
MaxAuthTries 3
X11Forwarding no
EOF
sshd -t
systemctl reload ssh

langkah "Firewall dan fail2ban"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null
cat > /etc/fail2ban/jail.d/lokerin.conf <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

langkah "Selesai"
echo "Lengkapi $ENV, lalu jalankan workflow deploy (atau migrasikan data dulu)."
