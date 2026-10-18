#!/usr/bin/env bash
# Deploy lokerin-backend di evergarden: tarik main, build image, migrasi, restart.
# Dipasang sebagai ~/.local/bin/lokerin-backend-deploy. GitHub Actions memanggilnya
# lewat SSH (forced command di authorized_keys); bisa juga dijalankan manual.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/dev/lokerin/lokerin-backend}"
SERVICE=lokerin-backend
HEALTH_URL=http://127.0.0.1:3120/healthz

cd "$APP_DIR"
exec 9>/tmp/lokerin-backend-deploy.lock
flock -n 9 || { echo "Deploy lain sedang berjalan" >&2; exit 1; }

git fetch --quiet origin main
git reset --hard --quiet origin/main
SHA="$(git rev-parse --short HEAD)"
echo "Deploy $SHA"

docker build --quiet -t "lokerin-backend:$SHA" . >/dev/null
docker run --rm --env-file .env "lokerin-backend:$SHA" node dist/db/migrate.js

PREV="$(docker image inspect -f '{{.Id}}' lokerin-backend:latest 2>/dev/null || true)"
docker tag "lokerin-backend:$SHA" lokerin-backend:latest
sudo systemctl restart "$SERVICE"

for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Sehat: $SHA"
    # Simpan tiga image terakhir untuk rollback manual.
    docker images lokerin-backend --format '{{.Tag}}' | grep -v '^latest$' | tail -n +4 \
      | xargs -r -I{} docker rmi "lokerin-backend:{}" >/dev/null || true
    exit 0
  fi
  sleep 2
done

echo "healthz gagal, kembali ke image sebelumnya" >&2
journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
if [ -n "$PREV" ]; then
  docker tag "$PREV" lokerin-backend:latest
  sudo systemctl restart "$SERVICE"
fi
exit 1
