#!/usr/bin/env bash
# Siapkan laptop untuk masuk ke VPS Lokerin (backend dan database). Jalankan sekali:
#
#   bash akses-laptop.sh                            # kunci berkomentar <nama>@lokerin-vps di ~/.ssh
#   bash akses-laptop.sh <nama-user> [kunci-privat]
#
# Tidak ada rahasia di file ini. Kunci privat tetap di laptopmu; yang dikirim ke Dika hanya kunci
# publik (.pub). Jalan di macOS, Linux, dan Git Bash di Windows.
#
# Setelah tersambung:
#   ssh lokerin-vps                                        masuk (sudo tanpa sandi)
#   ssh lokerin-vps journalctl -u lokerin-backend -f       log API
#   ssh lokerin-vps sudo -u deploy lokerin-deploy status   image yang berjalan + /healthz
#   ssh lokerin-vps sudo -u postgres psql lokerin          psql ke database produksi
#   ssh -N lokerin-db                                      tunnel database ke 127.0.0.1:5433
#   ssh lokerin-vps sudo grep ^DATABASE_URL= /etc/lokerin/backend.env
#                                                          user dan sandi DB (pakai port 5433 di tunnel)
# Deploy tidak dilakukan manual: push ke main men-deploy otomatis, rollback lewat GitHub Actions.
set -euo pipefail

IP=103.54.170.204
# Kunci host VPS (publik). Disematkan supaya SSH menolak bila yang menjawab bukan server Lokerin.
KUNCI_HOST="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ1tXFuobVCpu6X6EC/alG3WIaZ5pHzthXWCXOeZy3Rv"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

# Tanpa argumen: pakai kunci yang komentarnya "<nama>@lokerin-vps", dan <nama> jadi user di VPS.
NAMA="${1:-}"
KUNCI="${2:-}"
if [ -z "$KUNCI" ]; then
  for pub in "$HOME"/.ssh/*.pub; do
    [ -f "$pub" ] && [ -f "${pub%.pub}" ] || continue
    komentar="$(awk '{print $3}' "$pub")"
    case "$komentar" in
      *@lokerin-vps)
        if [ -z "$NAMA" ] || [ "$NAMA" = "${komentar%@lokerin-vps}" ]; then
          KUNCI="${pub%.pub}"
          NAMA="${komentar%@lokerin-vps}"
          break
        fi ;;
    esac
  done
fi
[ -n "$NAMA" ] || { echo "Pakai: bash $0 <nama-user> [kunci-privat]" >&2; exit 1; }
echo "User VPS: $NAMA"

if [ -z "$KUNCI" ]; then
  if [ -f "$HOME/.ssh/lokerin_vps" ]; then KUNCI="$HOME/.ssh/lokerin_vps"
  elif [ -f "$HOME/.ssh/id_ed25519" ]; then KUNCI="$HOME/.ssh/id_ed25519"
  else
    KUNCI="$HOME/.ssh/lokerin_vps"
    echo "Membuat kunci SSH baru di $KUNCI. Isi passphrase supaya aman bila laptop hilang."
    ssh-keygen -t ed25519 -C "$NAMA@lokerin-vps" -f "$KUNCI"
  fi
fi
KUNCI="${KUNCI/#\~/$HOME}"
[ -f "$KUNCI" ] || { echo "Kunci $KUNCI tidak ada" >&2; exit 1; }
[ -f "$KUNCI.pub" ] || ssh-keygen -y -f "$KUNCI" > "$KUNCI.pub"
echo "Kunci: $KUNCI ($(ssh-keygen -l -f "$KUNCI.pub" | awk '{print $2}'))"

touch "$HOME/.ssh/known_hosts"
for h in "$IP" api.lokerin.site; do
  grep -qF "$h $KUNCI_HOST" "$HOME/.ssh/known_hosts" || echo "$h $KUNCI_HOST" >> "$HOME/.ssh/known_hosts"
done

if grep -q "^Host lokerin-vps$" "$HOME/.ssh/config" 2>/dev/null; then
  echo "~/.ssh/config sudah punya Host lokerin-vps, tidak diubah."
else
  cat >> "$HOME/.ssh/config" <<EOF

Host lokerin-vps
  HostName $IP
  User $NAMA
  IdentityFile $KUNCI
  IdentitiesOnly yes
  AddKeysToAgent yes

# Database produksi lewat tunnel: ssh -N lokerin-db, lalu sambungkan ke 127.0.0.1:5433
Host lokerin-db
  HostName $IP
  User $NAMA
  IdentityFile $KUNCI
  IdentitiesOnly yes
  LocalForward 5433 127.0.0.1:5432
  ExitOnForwardFailure yes
EOF
  chmod 600 "$HOME/.ssh/config"
fi

echo
if ssh -o BatchMode=yes -o ConnectTimeout=10 lokerin-vps true 2>/dev/null; then
  echo "Tersambung. Coba: ssh lokerin-vps"
else
  echo "Cek otomatis belum tersambung (kunci dengan passphrase juga membuat cek ini gagal)."
  echo "Coba: ssh lokerin-vps"
  echo "Bila ditolak, kirim satu baris ini ke Dika (kunci publik, aman dikirim):"
  echo
  cat "$KUNCI.pub"
fi
