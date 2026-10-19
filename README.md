# lokerin-backend

Backend Lokerin, platform kerja berbasis suara dan teks untuk pekerjaan informal dan magang di Banyumas (ITASE 7.0, SDG 8). Frontend ada di [al-dioooo/lokerin-web](https://github.com/al-dioooo/lokerin-web), dokumen dan keputusan di [al-dioooo/lokerin-docs](https://github.com/al-dioooo/lokerin-docs) (ADR 0004, 0006, 0007). Istilah di kode mengikuti `GLOSSARY.md` di repo dokumen.

## Stack

Fastify 5 (TypeScript, Node 22+), agen Mastra dengan DeepSeek V4.1 Flash lewat OpenRouter, Neon Postgres + pgvector lewat Drizzle, suara OpenAI `gpt-live-1`, PDF CV dengan Chromium (Playwright), dan pembaruan langsung lewat Server-Sent Events.

## Menjalankan secara lokal

Butuh Node 22+, pnpm, dan Google Chrome (untuk PDF CV saat pengembangan).

```bash
pnpm install
cp .env.example .env   # isi DATABASE_URL, kunci API, SESSION_SECRET
pnpm db:migrate
pnpm db:seed           # mengatur ulang data demo Banyumas
pnpm dev               # http://localhost:8080
```

`pnpm db:embed` mengisi embedding yang masih kosong, misalnya bila seed berjalan saat kunci API bermasalah.

`pnpm eval:agen` memeriksa apakah agen memilih alat yang benar untuk 12 percakapan contoh. Alatnya tiruan, jadi tidak ada yang ditulis ke database, tetapi tiap skenario memanggil model sungguhan lewat OpenRouter.

## Variabel environment

Lihat `.env.example`. Yang wajib: `DATABASE_URL`, `SESSION_SECRET` (minimal 32 karakter), dan `OPENROUTER_API_KEY` (agen dan embedding). `OPENAI_API_KEY` hanya untuk panggilan suara; tanpanya, `POST /suara/sesi` menjawab 503 dan obrolan teks tetap jalan. `FRONTEND_ORIGINS` berisi origin frontend yang boleh memanggil API. `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY` (buat dengan `npx web-push generate-vapid-keys`) menyalakan push Kabar; tanpanya, Kabar tetap tersimpan dan tampil di aplikasi. `MAPBOX_SECRET_TOKEN` adalah token rahasia Mapbox (`sk.*`) dengan izin `tokens:write`; server memakainya untuk membuat token sementara baca-saja bagi peta di browser, dan token rahasianya tidak pernah dikirim ke frontend.

Database memakai ekstensi `vector` (pgvector, untuk pencocokan) dan `postgis` (untuk lowongan di sekitar). Migrasi `0003_postgis` menyalakan PostGIS dan menambah kolom `lowongan.titik` (geography, terisi otomatis dari lat dan lng) dengan indeks GiST.

## Sesi

Masuk dengan akun demo: `POST /auth/demo {"key":"pak-darto"}`. Respons berisi `token` dan juga memasang cookie `lokerin_sesi`. Frontend beda origin mengirim `Authorization: Bearer <token>`; `EventSource` memakai `/events?token=<token>`.

Onboarding membuat akun tamu sungguhan tanpa menimpa akun demo: `POST /auth/tamu {"peran":"pencari","nama":"Sari"}` (opsional `kota`, bawaan Purwokerto, dan `kecamatan`; maksimal 10 kali per menit per IP) menjawab dengan bentuk yang sama seperti `/auth/demo`. Pemberi Kerja tamu lalu mendaftarkan usahanya lewat `POST /pemberi/daftar`. Verifikasi masih demo: mencentang KTP hanya membuat status `menunggu`, dan lencana Terverifikasi tidak pernah diberikan otomatis. Nama dan lokasi bisa diubah lewat `PATCH /me`. Akun tamu ikut terhapus saat `pnpm db:seed`.

Masuk dengan Google memakai access token dari Google Identity Services di browser (tanpa client secret): `POST /auth/google {"access_token":"..."}`. Server memeriksa bahwa token diterbitkan untuk salah satu `GOOGLE_CLIENT_IDS` dan emailnya terverifikasi. Akun yang sudah ada langsung mendapat `token`. Akun baru dijawab `{"baru":true,"google":{"nama","email"}}` tanpa dibuat dulu; onboarding lalu mengirim ulang token dengan `daftar` (isi yang sama seperti `/auth/tamu`) untuk membuat akun. Bila `GOOGLE_CLIENT_IDS` kosong, rute ini menjawab 503 `google_belum_diatur`.

## CV Khusus

Isi CV terstruktur seperti CV LaTeX yang disukai perekrut ([ADR 0009](https://github.com/al-dioooo/lokerin-docs/blob/main/docs/adr/0009-ngobrol-dua-mode-cv-latex-dan-peta.md)): bagian (Pengalaman, Pendidikan, Proyek, Prestasi) berisi entri dengan judul, tempat, periode, dan poin, ditambah kelompok keahlian. Setiap entri dan poin menunjuk ke Fakta asal; yang tidak punya Fakta sah dibuang. PDF dicetak Chromium dari HTML yang sama dengan pratinjau di aplikasi, dengan huruf CMU Serif yang disematkan (SIL OFL, `src/cv/fonts/OFL.txt`). `GET /cv/:id/pdf?unduh=1` memberi nama berkas seperti `CV - Sari Wulandari - Juru Masak.pdf`. CV versi lama diubah ke bentuk baru saat dibaca.

## Kabar

Kabar adalah pemberitahuan yang disimpan ([ADR 0008](https://github.com/al-dioooo/lokerin-docs/blob/main/docs/adr/0008-alat-agen-tanya-pengguna-dan-kabar.md)). Pemberi Kerja mendapat Kabar saat Lamaran masuk. Pencari Kerja mendapat Kabar saat Lamarannya Dilihat (hanya di aplikasi), Lolos, Tidak Lolos, atau mendapat Tahap Berikutnya baru, dan saat ada Butuh Hari Ini yang cocok dengan Personanya di kotanya (paling banyak 50 penerima). Setiap Kabar baru juga dikirim sebagai event SSE `kabar.baru` dan, bila perangkatnya berlangganan, sebagai Web Push. Isi push tidak memuat kontak; `tautan` membuka rinciannya di aplikasi.

## Endpoint utama

| Area | Endpoint |
|---|---|
| Sesi | `GET /auth/akun-demo`, `POST /auth/demo`, `POST /auth/tamu`, `POST /auth/google`, `POST /auth/keluar`, `GET /me`, `PATCH /me` |
| Pembaruan langsung | `GET /events?kota=Purwokerto` (SSE: `lowongan.baru`, `butuh_hari_ini`, `lowongan.tutup`, `lamaran.masuk`, `lamaran.status`, `kabar.baru`, `suara.*`) |
| Kabar | `GET /kabar`, `POST /kabar/baca` (tanpa `ids` berarti semua), `GET /push/kunci`, `POST /push/langganan`, `DELETE /push/langganan` |
| Lowongan | `GET /lowongan`, `POST /lowongan/cari`, `GET /lowongan/peta`, `GET /lowongan/statistik`, `GET /lowongan/:id`, `POST /lowongan/:id/laporkan` |
| Pemberi Kerja | `POST /pemberi/daftar`, `GET/POST /pemberi/lowongan`, `PATCH /pemberi/lowongan/:id`, `POST /pemberi/lowongan/:id/terbit`, `POST /pemberi/lowongan/:id/tutup`, `GET /pemberi/lamaran` |
| Profil Induk | `GET /profil`, `POST /fakta`, `POST /fakta/putuskan`, `POST /persona`, `PATCH /persona/:id`, `GET /kartu-kerja/:id` |
| Lamaran | `POST /lamaran`, `GET /pencari/lamaran`, `GET /lamaran/:id`, `POST /lamaran/:id/dilihat`, `POST /lamaran/:id/lolos`, `POST /lamaran/:id/tidak-lolos`, `POST /lamaran/:id/tahap` |
| CV Khusus | `POST /cv`, `GET /cv/:id`, `PATCH /cv/:id`, `GET /cv/:id/html`, `GET /cv/:id/pdf` |
| Asisten | `POST /chat` (AI SDK v7 `useChat`), `GET /chat/obrolan`, `DELETE /chat/obrolan/:id`, `GET /chat/riwayat?id=`, `POST /suara/sesi`, `DELETE /suara/sesi/:id` |
| Peta | `GET /lowongan/peta?lat=&lng=&radius_km=&butuh_hari_ini=` (PostGIS `ST_DWithin`), `GET /peta/kunci` (token Mapbox sementara) |

## Aturan yang dijaga di kode

- Agen hanya menyiapkan (ADR 0004). Terbit, kirim Lamaran, Lolos, dan menyimpan Fakta hanya lewat endpoint yang dipanggil tombol.
- CV Khusus hanya berisi poin yang menunjuk ke Fakta terkonfirmasi; poin tanpa Fakta dibuang.
- Kontak Pencari Kerja tersembunyi dari Pemberi Kerja sampai Lamaran Lolos, termasuk di PDF CV.
- Pemeriksaan menahan Lowongan yang field wajibnya kosong atau meminta biaya dari pelamar, dan memberi Peringatan Upah dibanding UMK Banyumas.

## Deploy ke VPS IDCloudHost

API dan database berjalan di satu VPS IDCloudHost (Jakarta, 2 vCPU / 4 GB / 40 GB, Ubuntu 24.04), supaya query dari API ke Postgres tidak menyeberang jaringan.

- **API**: container Docker `lokerin-backend.service`, hanya di `127.0.0.1:3120`. Caddy membuka `https://api.lokerin.site` dan mengurus sertifikatnya sendiri.
- **Database**: Postgres 18 + PostGIS + pgvector, hanya mendengar localhost. Backup `pg_dump` setiap hari pukul 03.15 WIB ke `/var/backups/lokerin`, disimpan 14 hari.
- **Rahasia**: `.env` produksi ada di `/etc/lokerin/backend.env` (root:deploy, 640). Tidak pernah di-commit dan tidak lewat GitHub.

### Alur CI/CD

`.github/workflows/deploy.yml`:

1. Setiap PR: typecheck, build, dan build image Docker tanpa push.
2. Push ke `main`: image didorong ke `ghcr.io/dikaprilio/lokerin-backend:<sha>`, lalu job `deploy` SSH ke VPS sebagai user `deploy`.
3. Di server, `lokerin-deploy` menarik image itu, menjalankan migrasi, mengganti `lokerin-backend:current`, restart, dan cek `/healthz`. Bila gagal, image sebelumnya dipasang lagi otomatis.
4. Rollback manual: Actions → CI/CD backend → Run workflow → `rollback`. Migrasi tidak ikut dibatalkan, jadi migrasi harus tetap cocok dengan kode versi sebelumnya (tambah kolom dulu, hapus belakangan).

### Prinsip SSH

- Login hanya dengan kunci. Password SSH dan login root dimatikan, dan hanya anggota grup `lokerin-ssh` (admin tim dan `deploy`) yang boleh masuk. Ada juga ufw (22, 80, 443) dan fail2ban.
- Setiap orang punya user dan kuncinya sendiri, jadi akses bisa dicabut per orang tanpa mengganti kunci orang lain. Kunci privat tidak pernah dikirim; yang dikirim hanya kunci publik.
- Kunci CI adalah kunci khusus yang tidak dipakai di tempat lain. Di `authorized_keys` milik `deploy` kunci itu diawali `command="/usr/local/bin/lokerin-deploy",restrict`: tanpa shell, tanpa port forwarding, dan hanya bisa `deploy <sha>`, `rollback`, atau `status`.
- `lokerin-deploy` milik root, jadi user `deploy` tidak bisa mengubah perintah yang dijalankan kuncinya. Sudo untuk `deploy` hanya `systemctl restart/stop lokerin-backend` dan `journalctl` unit itu.
- Kunci host server disematkan di workflow (`DEPLOY_KNOWN_HOST`), jadi CI menolak bila yang menjawab bukan server ini.
- Token GHCR untuk pull adalah `GITHUB_TOKEN` milik job. Token ini dikirim lewat stdin, berlaku selama job saja, dan langsung di-logout setelah pull.

### Akses tim

Anggota baru menjalankan `deploy/vps/akses-laptop.sh` di laptopnya. Skrip ini memakai atau membuat kunci berkomentar `<nama>@lokerin-vps`, menyematkan kunci host VPS, dan menambahkan `ssh lokerin-vps` serta tunnel `ssh -N lokerin-db` (Postgres di `127.0.0.1:5433`). Ia lalu mengirim kunci publiknya, dan admin menambahkannya:

```bash
ssh lokerin-vps sudo lokerin-tambah-admin <nama> "<kunci publik>"
ssh lokerin-vps sudo deluser --remove-home <nama>     # cabut akses
```

Admin masuk ke grup `lokerin-ssh` dan `lokerin-admin` (sudo tanpa sandi) serta bisa membaca log. User `deploy` tetap khusus untuk CI.

### Pemasangan sekali

```bash
scp -r deploy/vps lokerin@<ip>:/tmp/lokerin-vps
ssh lokerin@<ip> "sudo setsid nohup bash /tmp/lokerin-vps/bootstrap.sh '$(cat ~/.ssh/lokerin_deploy.pub)' > /tmp/lokerin-bootstrap.log 2>&1 < /dev/null &"
ssh lokerin@<ip> tail -f /tmp/lokerin-bootstrap.log
```

Skrip berjalan terlepas dari sesi SSH, jadi koneksi yang putus tidak menghentikannya di tengah upgrade paket.

Lalu lengkapi `/etc/lokerin/backend.env` dari `.env.example`. `DATABASE_URL`, `SESSION_SECRET`, dan origin sudah diisi skrip. Isi secret repo `DEPLOY_SSH_KEY` dengan kunci privat `lokerin_deploy`, lalu ganti `DEPLOY_HOST` dan `DEPLOY_KNOWN_HOST` di workflow (`ssh-keyscan -t ed25519 <ip>`).

Perubahan di `deploy/vps/*` baru berlaku setelah `bootstrap.sh` dijalankan ulang. Skrip ini aman diulang dan tidak menimpa `backend.env`. Docker dan Postgres hanya di-restart bila berkas konfigurasinya berubah, jadi menjalankan ulang tanpa perubahan tidak memutus API.

### Perintah harian

```bash
ssh lokerin-vps sudo -u deploy lokerin-deploy status   # image yang berjalan + /healthz
ssh lokerin-vps journalctl -u lokerin-backend -f        # log API
ssh lokerin-vps sudo -u postgres psql lokerin           # psql produksi
ssh -N lokerin-db                                        # tunnel Postgres ke 127.0.0.1:5433
```

Jangan deploy atau mengubah pengaturan saat penjurian: restart memutus panggilan suara.
