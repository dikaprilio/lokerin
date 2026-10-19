#!/usr/bin/env bash
# Beri anggota tim akses admin ke VPS: user sendiri, login hanya dengan kunci, sudo tanpa sandi.
# Dipasang sebagai /usr/local/bin/lokerin-tambah-admin oleh bootstrap.sh.
#
#   sudo lokerin-tambah-admin aldio "ssh-ed25519 AAAA... aldio@lokerin-vps"
#
# Kunci publiknya dikirim balik oleh skrip akses-laptop.sh di laptop orang itu.
# Cabut akses: sudo deluser --remove-home <nama>
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo" >&2; exit 1; }
NAMA="${1:-}"
KUNCI="${2:-}"
[[ "$NAMA" =~ ^[a-z_][a-z0-9_-]{1,24}$ ]] || { echo "Pakai: lokerin-tambah-admin <nama> \"<kunci publik>\"" >&2; exit 1; }
[ "$NAMA" != deploy ] || { echo "User deploy khusus untuk CI" >&2; exit 1; }
case "$KUNCI" in ssh-ed25519\ *|sk-ssh-ed25519@openssh.com\ *|ecdsa-sha2-nistp256\ *) ;; *) echo "Kunci publik harus ed25519 atau ecdsa" >&2; exit 1 ;; esac
ssh-keygen -l -f /dev/stdin <<< "$KUNCI" >/dev/null || { echo "Kunci publik tidak valid" >&2; exit 1; }

id "$NAMA" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$NAMA"
usermod -aG lokerin-ssh,lokerin-admin,adm,systemd-journal "$NAMA"
install -d -m 700 -o "$NAMA" -g "$NAMA" "/home/$NAMA/.ssh"
BERKAS="/home/$NAMA/.ssh/authorized_keys"
touch "$BERKAS"
grep -qxF "$KUNCI" "$BERKAS" || echo "$KUNCI" >> "$BERKAS"
chown "$NAMA:$NAMA" "$BERKAS"
chmod 600 "$BERKAS"
echo "$NAMA sudah bisa masuk: ssh lokerin-vps (sidik kunci $(ssh-keygen -l -f /dev/stdin <<< "$KUNCI" | awk '{print $2}'))"
