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

Lihat `.env.example`. Yang wajib: `DATABASE_URL`, `SESSION_SECRET` (minimal 32 karakter), dan `OPENROUTER_API_KEY` (agen dan embedding). `OPENAI_API_KEY` hanya untuk panggilan suara; tanpanya, `POST /suara/sesi` menjawab 503 dan obrolan teks tetap jalan. `FRONTEND_ORIGINS` berisi origin frontend yang boleh memanggil API. `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY` (buat dengan `npx web-push generate-vapid-keys`) menyalakan push Kabar; tanpanya, Kabar tetap tersimpan dan tampil di aplikasi.

## Sesi

Masuk dengan akun demo: `POST /auth/demo {"key":"pak-darto"}`. Respons berisi `token` dan juga memasang cookie `lokerin_sesi`. Frontend beda origin mengirim `Authorization: Bearer <token>`; `EventSource` memakai `/events?token=<token>`.

Onboarding membuat akun tamu sungguhan tanpa menimpa akun demo: `POST /auth/tamu {"peran":"pencari","nama":"Sari"}` (opsional `kota`, bawaan Purwokerto, dan `kecamatan`; maksimal 10 kali per menit per IP) menjawab dengan bentuk yang sama seperti `/auth/demo`. Pemberi Kerja tamu lalu mendaftarkan usahanya lewat `POST /pemberi/daftar`. Verifikasi masih demo: mencentang KTP hanya membuat status `menunggu`, dan lencana Terverifikasi tidak pernah diberikan otomatis. Nama dan lokasi bisa diubah lewat `PATCH /me`. Akun tamu ikut terhapus saat `pnpm db:seed`.

Masuk dengan Google memakai access token dari Google Identity Services di browser (tanpa client secret): `POST /auth/google {"access_token":"..."}`. Server memeriksa bahwa token diterbitkan untuk salah satu `GOOGLE_CLIENT_IDS` dan emailnya terverifikasi. Akun yang sudah ada langsung mendapat `token`. Akun baru dijawab `{"baru":true,"google":{"nama","email"}}` tanpa dibuat dulu; onboarding lalu mengirim ulang token dengan `daftar` (isi yang sama seperti `/auth/tamu`) untuk membuat akun. Bila `GOOGLE_CLIENT_IDS` kosong, rute ini menjawab 503 `google_belum_diatur`.

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
| Asisten | `POST /chat` (AI SDK v7 `useChat`), `GET /chat/riwayat`, `POST /suara/sesi`, `DELETE /suara/sesi/:id` |

## Aturan yang dijaga di kode

- Agen hanya menyiapkan (ADR 0004). Terbit, kirim Lamaran, Lolos, dan menyimpan Fakta hanya lewat endpoint yang dipanggil tombol.
- CV Khusus hanya berisi poin yang menunjuk ke Fakta terkonfirmasi; poin tanpa Fakta dibuang.
- Kontak Pencari Kerja tersembunyi dari Pemberi Kerja sampai Lamaran Lolos, termasuk di PDF CV.
- Pemeriksaan menahan Lowongan yang field wajibnya kosong atau meminta biaya dari pelamar, dan memberi Peringatan Upah dibanding UMK Banyumas.

## Deploy ke Azure App Service

Workflow `.github/workflows/deploy.yml` membangun image dari `Dockerfile` (berbasis image Playwright agar Chromium tersedia), mendorongnya ke ACR, lalu memperbarui App Service.

1. Buat App Service Linux B1 di Southeast Asia (container), ACR Basic, dan federated credential GitHub untuk OIDC.
2. Secrets repo: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Variables: `ACR_NAME`, `AZURE_WEBAPP_NAME`.
3. Pengaturan App Service: Always On aktif, HTTPS only, session affinity mati, health check `/healthz`, `WEBSITES_PORT=8080`, `WEBSITES_CONTAINER_START_TIME_LIMIT=600`, plus semua variabel dari `.env.example`.
4. Jangan deploy atau mengubah pengaturan saat penjurian: restart memutus panggilan suara.
