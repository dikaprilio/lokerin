# Data seed demo Lokerin

- **Semua data di folder ini fiktif.** Nama usaha, nama orang, alamat rinci, nomor HP (format `0812-0000-xxxx`), dan email (`@example.com`) dikarang untuk demo. Tidak ada nomor KTP/NPWP; `checks` hanya menandai dokumen yang dianggap sudah dicek.
- **Acuan UMK** (`upah.json`): UMK Kabupaten Banyumas 2026 Rp2.474.598,99/bulan, dari [Keputusan Gubernur Jawa Tengah No. 100.3.3.1/505 Tahun 2025, Lampiran I](https://jdih.jatengprov.go.id/inventarisasi-hukum/file/kepgub_100-3-3-1-505_th_2025/sk_100.3.3.1-505_th_2025_auten.pdf). Angkanya sama dengan [siaran pers Pemprov Jateng 24/12/2025](https://jatengprov.go.id/publik/gubernur-ahmad-luthfi-tetapkan-ump-jawa-tengah-2026-rp2-327-38607/). Diakses 18 Oktober 2026.
- `pemberi-kerja.json`: 12 Pemberi Kerja (7 UMKM, 2 rumah tangga, 3 perusahaan yang buka magang). 11 terverifikasi, 1 belum (`belum-verif`).
- `lowongan.json`: 50 Lowongan, terdiri dari 40 informal dan 10 magang (2 magang berbahasa Inggris). 4 Lowongan "Butuh Hari Ini" mulai 18 Oktober 2026.
- Dua Lowongan sengaja diberi upah di bawah UMK untuk demo peringatan upah: `sari-rejeki-penjaga-toko-wangon` dan `lereng-pelayan-warung-wisata`. Tidak ada Lowongan yang memungut uang dari pelamar.
- `pencari-kerja.json`: 2 Pencari Kerja demo. `pak-darto` punya Persona Tukang Las dan Driver Ojol; `raka` punya Persona Desainer UI/UX dan Frontend Developer (magang).
- Kolom `city` berisi `Purwokerto` untuk 4 kecamatan kota dan `Banyumas` untuk kecamatan lain di Kabupaten Banyumas. Ada 4 Lowongan di Purbalingga dan Cilacap supaya filter lokasi terlihat bekerja. Koordinat berupa titik perkiraan di kecamatan yang disebut.
