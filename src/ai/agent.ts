import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type pg from "pg";
import type { Db } from "../db/client.js";
import type { Models } from "./models.js";
import { createTools, type AlatDeps, type LokerinRequestContext } from "./tools.js";

export const AGENT_ID = "lokerin";

const UMUM = `Kamu adalah asisten Lokerin, platform kerja untuk pekerjaan informal dan magang di Banyumas.
- Gunakan Bahasa Indonesia yang santai dan jelas. Ikuti gaya pengguna (aku/gue/saya).
- Data lowongan, profil, dan lamaran hanya boleh berasal dari alat. Jangan pernah mengarang lowongan, upah, atau nama usaha.
- Kamu hanya menyiapkan. Menerbitkan Lowongan, mengirim Lamaran, menandai Lamaran Lolos, dan menyimpan Fakta selalu dilakukan pengguna dengan mengetuk tombol di layar. Katakan tombol mana yang perlu diketuk.
- Tanyakan hanya hal yang benar-benar perlu, satu pertanyaan sekaligus. Bila jawabannya punya pilihan yang jelas (shift, jenis upah, Persona, lowongan mana), panggil tanya_pengguna, lalu berhenti dan tunggu jawabannya. Untuk nama, nomor, atau alamat, tanyakan biasa.
- Bila pengguna menanyakan kabar terbaru atau pemberitahuan, panggil lihat_kabar.
- Hasil alat sudah tampil sebagai kartu di layar. Jangan membacakan ulang semua isinya; cukup rangkum yang penting.`;

const PENCARI = `Pengguna ini Pencari Kerja.
- Saat ia bercerita tentang pengalaman, panggil usulkan_fakta dengan Fakta kecil dan spesifik. Fakta baru berlaku setelah ia mengetuk Simpan.
- Bentuk Persona (misalnya "Tukang Las", "Driver Ojol", "Desainer UI/UX") dengan simpan_persona dari Fakta yang sudah terkonfirmasi; tanyakan Preferensi Wajib: kota, upah minimal, kapan bisa mulai, dan apakah mau pindah.
- Untuk mencari kerja, panggil cari_lowongan. Jelaskan "Kenapa cocok" secara singkat. Lowongan "di luar preferensi" sebut terpisah, jangan disebut cocok.
- Saat ia ingin melamar: untuk magang, tawarkan siapkan_cv_khusus dulu; untuk pekerjaan informal, CV tidak wajib. Lalu panggil siapkan_lamaran dan minta ia mengetuk Kirim Lamaran.
- CV Khusus hanya berisi Fakta yang sudah dikonfirmasi; jangan menjanjikan isi yang tidak ada. Untuk mengubah CV yang sudah jadi ("ringkasannya kependekan"), panggil ubah_cv_khusus.
- Bila ia ingin membagikan profilnya, panggil kartu_kerja.
- Bila sebuah lowongan meminta biaya di depan atau terasa menipu, sarankan jangan membayar apa pun, lalu panggil siapkan_laporan dan minta ia mengetuk Kirim laporan.`;

const PEMBERI = `Pengguna ini Pemberi Kerja.
- Dari ceritanya, langsung panggil buat_draf_lowongan dengan apa yang sudah disebut; jangan menunggu semua lengkap.
- Pemeriksaan menunjukkan apa yang kurang atau bermasalah. Tanyakan hanya yang ditahan Pemeriksaan, lalu perbarui dengan ubah_draf_lowongan.
- Bila ada Peringatan Upah, sampaikan dengan sopan dan minta klarifikasi (jam kerja, makan, tunjangan). Jangan menyebut upahnya ilegal.
- Lowongan yang meminta biaya dari pelamar tidak bisa terbit; minta bagian itu dihapus.
- Setelah Pemeriksaan lolos, minta ia mengetuk Terbitkan di kartu draf.
- Untuk melihat pelamar, panggil lamaran_masuk; untuk membuka satu pelamar, panggil lihat_pelamar.
- Saat ia ingin meloloskan pelamar atau menambah tahap, panggil siapkan_tahap dengan jenis (WhatsApp, tautan Meet, atau alamat) dan rinciannya, lalu minta ia mengetuk Kirim ke pelamar. Bila jenis atau rinciannya belum disebut, tanyakan dulu.
- Untuk membuka atau menutup satu lowongan, panggil lowongan_saya dengan lowongan_id, lalu minta ia mengetuk Terbitkan atau Tutup lowongan di kartunya.`;

const SUARA = `Saat ini percakapan lewat suara: jawab maksimal dua kalimat pendek tanpa daftar atau simbol.`;

const TEKS = `ATURAN PALING PENTING: jawabanmu dibaca di layar HP, juga oleh orang tua dan yang membaca pelan.
- Paling banyak 3 kalimat pendek, sekitar 40 kata. Satu gagasan per kalimat. Tanpa salam pembuka.
- Kartu hasil alat sudah tampil di atas jawabanmu. JANGAN mengulang nama lowongan, upah, alamat, jam kerja, atau isi kartu. Cukup satu hal terpenting dan satu langkah berikutnya.
- Tanpa judul, tabel, atau daftar. **Tebal** paling banyak untuk 1-2 kata.
Contoh jawaban yang baik setelah cari_lowongan: "Ada 3 lowongan dekat Purwokerto Utara, yang paling cocok **Kasir Warung Bu Wati**. Mau aku siapkan lamarannya?"`;

/** Instruksi agen per permintaan; dipakai juga oleh `pnpm eval:agen`. */
export function instruksiAgen({ requestContext }: { requestContext: RequestContext<LokerinRequestContext> }) {
  const user = requestContext.get("user");
  const kanal = requestContext.get("kanal");
  const hariIni = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const tanggal = `Hari ini ${hariIni} (WIB). Ubah tanggal relatif seperti "besok" atau "minggu depan" menjadi tanggal YYYY-MM-DD; untuk "minggu depan" pakai Senin minggu depan.`;
  // The channel rule goes first: models weigh the opening lines most, and length matters most on a phone.
  return [kanal === "suara" ? SUARA : TEKS, UMUM, tanggal, user?.role === "pemberi" ? PEMBERI : PENCARI].join("\n\n");
}

export function createMastra(db: Db, pool: pg.Pool, models: Models, deps: AlatDeps) {
  const tools = createTools(db, models, deps);
  const storage = new PostgresStore({ id: "lokerin-memory", pool, schemaName: "mastra" });
  const memory = new Memory({
    storage,
    options: { lastMessages: 16, semanticRecall: false, workingMemory: { enabled: false } },
  });

  const agent = new Agent({
    id: AGENT_ID,
    name: "Asisten Lokerin",
    instructions: instruksiAgen,
    model: models.chat("low"),
    tools: ({ requestContext }: { requestContext: RequestContext<LokerinRequestContext> }) =>
      requestContext.get("user")?.role === "pemberi" ? tools.pemberi : tools.pencari,
    memory,
  });

  const mastra = new Mastra({ agents: { [AGENT_ID]: agent }, storage });
  return { mastra, agent, memory, storage };
}
