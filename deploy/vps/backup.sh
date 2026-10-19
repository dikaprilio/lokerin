#!/usr/bin/env bash
# Backup harian database lokerin, dijalankan cron sebagai postgres. Menyimpan 14 hari.
# Pulihkan: sudo -u postgres pg_restore --clean --if-exists -d lokerin <berkas>.dump
set -euo pipefail

DIR=/var/backups/lokerin
BERKAS="$DIR/lokerin-$(date -u +%Y%m%d-%H%M).dump"
pg_dump -Fc -d lokerin -f "$BERKAS.tmp"
mv "$BERKAS.tmp" "$BERKAS"
find "$DIR" -name 'lokerin-*.dump' -mtime +14 -delete
