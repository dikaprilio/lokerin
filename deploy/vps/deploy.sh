#!/usr/bin/env bash
# Skrip deploy di VPS, dipasang sebagai /usr/local/bin/lokerin-deploy (milik root).
# Kunci deploy di /home/deploy/.ssh/authorized_keys memakai forced command ke skrip ini,
# jadi kunci itu hanya bisa menjalankan perintah di bawah, bukan shell:
#
#   deploy <sha>   tarik image <sha> dari GHCR, migrasi, restart, cek /healthz, rollback bila gagal
#   rollback       tukar ke image sebelumnya
#   status         image yang berjalan dan isi /healthz
#
# Untuk deploy, baris pertama stdin berisi "<pengguna> <token>" untuk ghcr.io (GITHUB_TOKEN
# milik job). Token hanya dipakai untuk pull ini, lalu logout.
# Manual: sudo -u deploy lokerin-deploy status
set -euo pipefail

REPO=ghcr.io/dikaprilio/lokerin-backend
LOKAL=lokerin-backend
ENV=/etc/lokerin/backend.env
SERVICE=lokerin-backend
SEHAT=http://127.0.0.1:3120/healthz

read -r -a ARG <<< "${SSH_ORIGINAL_COMMAND:-$*}"
PERINTAH="${ARG[0]:-}"

gagal() { echo "$*" >&2; exit 1; }
ada() { docker image inspect "$1" >/dev/null 2>&1; }
mulai_ulang() { sudo /usr/bin/systemctl restart "$SERVICE"; }
sehat() {
  for _ in $(seq 1 45); do
    curl -fsS --max-time 3 "$SEHAT" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

exec 9>/tmp/lokerin-deploy.lock
flock -n 9 || gagal "Deploy lain sedang berjalan"

case "$PERINTAH" in
  deploy)
    SHA="${ARG[1]:-}"
    [[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || gagal "Pakai: deploy <sha>"
    if IFS=' ' read -r -t 5 PENGGUNA TOKEN && [ -n "${TOKEN:-}" ]; then
      trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
      printf '%s' "$TOKEN" | docker login ghcr.io -u "$PENGGUNA" --password-stdin >/dev/null
    fi
    unset TOKEN

    echo "Tarik $REPO:$SHA"
    docker pull -q "$REPO:$SHA" >/dev/null
    echo "Migrasi"
    docker run --rm --network host --env-file "$ENV" "$REPO:$SHA" node dist/db/migrate.js

    if ada "$LOKAL:current"; then docker tag "$LOKAL:current" "$LOKAL:previous"; fi
    docker tag "$REPO:$SHA" "$LOKAL:current"
    mulai_ulang
    if sehat; then
      echo "Sehat: $SHA"
      # Simpan tiga image terakhir dari GHCR; current dan previous tetap ada karena bertag.
      docker images "$REPO" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r | tail -n +4 | cut -d'|' -f2 \
        | xargs -r -I{} docker rmi "$REPO:{}" >/dev/null 2>&1 || true
      docker image prune -f >/dev/null
      exit 0
    fi

    echo "healthz gagal setelah deploy $SHA" >&2
    sudo /usr/bin/journalctl -u "$SERVICE" -n 60 --no-pager >&2 || true
    if ada "$LOKAL:previous"; then
      docker tag "$LOKAL:previous" "$LOKAL:current"
      mulai_ulang
      sehat && echo "Kembali ke image sebelumnya" >&2
    fi
    exit 1
    ;;

  rollback)
    ada "$LOKAL:previous" || gagal "Belum ada image sebelumnya"
    # Tukar, supaya rollback kedua kembali maju.
    docker tag "$LOKAL:current" "$LOKAL:tukar"
    docker tag "$LOKAL:previous" "$LOKAL:current"
    docker tag "$LOKAL:tukar" "$LOKAL:previous"
    docker rmi "$LOKAL:tukar" >/dev/null
    mulai_ulang
    sehat || gagal "healthz gagal setelah rollback"
    echo "Rollback selesai. Migrasi tidak dibatalkan: skema tetap yang terbaru."
    ;;

  status)
    docker image inspect -f '{{index .RepoTags 0}} {{.Created}}' "$LOKAL:current" 2>/dev/null || echo "Belum ada image"
    curl -fsS --max-time 3 "$SEHAT" || gagal "healthz tidak menjawab"
    echo
    ;;

  *)
    gagal "Perintah: deploy <sha> | rollback | status"
    ;;
esac
