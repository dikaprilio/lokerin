# Lokerin API

Backend Lokerin: Fastify (TypeScript) dengan agen Mastra, Neon Postgres + pgvector, suara `gpt-live-1`, dan PDF CV lewat Chromium. Keputusan arsitekturnya ada di `lokerin-docs` (ADR 0004, 0006, 0007) dan istilahnya mengikuti `GLOSSARY.md`.

## Menjalankan secara lokal

Butuh Node 22+, pnpm, dan Google Chrome (untuk PDF CV saat pengembangan).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # isi DATABASE_URL, kunci API, SESSION_SECRET
pnpm --filter @lokerin/api db:migrate
pnpm --filter @lokerin/api db:seed       # mengatur ulang data demo Banyumas
pnpm dev:api                              # http://localhost:8080
```

## Variabel environment

Lihat `.env.example`. Yang wajib: `DATABASE_URL`, `SESSION_SECRET` (≥32 karakter), `OPENROUTER_API_KEY`, `OPENAI_API_KEY`. `FRONTEND_ORIGINS` berisi origin frontend yang boleh memanggil API.

## Sesi

Masuk dengan akun demo: `POST /auth/demo {"key":"pak-darto"}`. Respons berisi `token` dan juga memasang cookie `lokerin_sesi`. Frontend beda origin mengirim `Authorization: Bearer <token>`; `EventSource` memakai `/events?token=<token>`.

## Endpoint utama

| Area | Endpoint |
|---|---|
| Sesi | `GET /auth/akun-demo`, `POST /auth/demo`, `POST /auth/keluar`, `GET /me` |
| Pembaruan langsung | `GET /events?kota=Purwokerto` (SSE: `lowongan.baru`, `butuh_hari_ini`, `lamaran.masuk`, `lamaran.status`, `suara.*`) |
| Lowongan | `GET /lowongan`, `POST /lowongan/cari`, `GET /lowongan/peta`, `GET /lowongan/statistik`, `GET /lowongan/:id`, `POST /lowongan/:id/laporkan` |
| Pemberi Kerja | `GET/POST /pemberi/lowongan`, `PATCH /pemberi/lowongan/:id`, `POST /pemberi/lowongan/:id/terbit`, `POST /pemberi/lowongan/:id/tutup`, `GET /pemberi/lamaran` |
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

Workflow `.github/workflows/deploy-api.yml` membangun image dari `apps/api/Dockerfile` (berbasis image Playwright agar Chromium tersedia), mendorongnya ke ACR, lalu memperbarui App Service.

1. Buat App Service Linux B1 di Southeast Asia (container), ACR Basic, dan federated credential GitHub untuk OIDC.
2. Secrets repo: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Variables: `ACR_NAME`, `AZURE_WEBAPP_NAME`.
3. Pengaturan App Service: Always On aktif, HTTPS only, session affinity mati, health check `/healthz`, `WEBSITES_PORT=8080`, `WEBSITES_CONTAINER_START_TIME_LIMIT=600`, plus semua variabel dari `.env.example`.
4. Jangan deploy atau mengubah pengaturan saat penjurian: restart memutus panggilan suara.
