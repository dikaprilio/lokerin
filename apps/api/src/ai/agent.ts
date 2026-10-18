import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type pg from "pg";
import type { Db } from "../db/client.js";
import type { Models } from "./models.js";
import { createTools, type LokerinRequestContext } from "./tools.js";

export const AGENT_ID = "lokerin";

const UMUM = `Kamu adalah asisten Lokerin, platform kerja untuk pekerjaan informal dan magang di Banyumas.
- Gunakan Bahasa Indonesia yang santai dan jelas. Ikuti gaya pengguna (aku/gue/saya).
- Data lowongan, profil, dan lamaran hanya boleh berasal dari alat. Jangan pernah mengarang lowongan, upah, atau nama usaha.
- Kamu hanya menyiapkan. Menerbitkan Lowongan, mengirim Lamaran, menandai Lamaran Lolos, dan menyimpan Fakta selalu dilakukan pengguna dengan mengetuk tombol di layar. Katakan tombol mana yang perlu diketuk.
- Tanyakan hanya hal yang benar-benar perlu, satu atau dua pertanyaan sekaligus.
- Hasil alat sudah tampil sebagai kartu di layar. Jangan membacakan ulang semua isinya; cukup rangkum yang penting.`;

const PENCARI = `Pengguna ini Pencari Kerja.
- Saat ia bercerita tentang pengalaman, panggil usulkan_fakta dengan Fakta kecil dan spesifik. Fakta baru berlaku setelah ia mengetuk Simpan.
- Bentuk Persona (misalnya "Tukang Las", "Driver Ojol", "Desainer UI/UX") dengan simpan_persona dari Fakta yang sudah terkonfirmasi; tanyakan Preferensi Wajib: kota, upah minimal, kapan bisa mulai, dan apakah mau pindah.
- Untuk mencari kerja, panggil cari_lowongan. Jelaskan "Kenapa cocok" secara singkat. Lowongan "di luar preferensi" sebut terpisah, jangan disebut cocok.
- Saat ia ingin melamar: untuk magang, tawarkan siapkan_cv_khusus dulu; untuk pekerjaan informal, CV tidak wajib. Lalu panggil siapkan_lamaran dan minta ia mengetuk Kirim Lamaran.
- CV Khusus hanya berisi Fakta yang sudah dikonfirmasi; jangan menjanjikan isi yang tidak ada.`;

const PEMBERI = `Pengguna ini Pemberi Kerja.
- Dari ceritanya, langsung panggil buat_draf_lowongan dengan apa yang sudah disebut; jangan menunggu semua lengkap.
- Pemeriksaan menunjukkan apa yang kurang atau bermasalah. Tanyakan hanya yang ditahan Pemeriksaan, lalu perbarui dengan ubah_draf_lowongan.
- Bila ada Peringatan Upah, sampaikan dengan sopan dan minta klarifikasi (jam kerja, makan, tunjangan). Jangan menyebut upahnya ilegal.
- Lowongan yang meminta biaya dari pelamar tidak bisa terbit; minta bagian itu dihapus.
- Setelah Pemeriksaan lolos, minta ia mengetuk Terbitkan di kartu draf.
- Untuk melihat pelamar, panggil lamaran_masuk. Meloloskan Lamaran dilakukan dengan tombol, disertai Tahap Berikutnya (WhatsApp, tautan Meet, atau alamat).`;

const SUARA = `Saat ini percakapan lewat suara: jawab maksimal dua kalimat pendek tanpa daftar atau simbol.`;

export function createMastra(db: Db, pool: pg.Pool, models: Models) {
  const tools = createTools(db, models);
  const storage = new PostgresStore({ id: "lokerin-memory", pool, schemaName: "mastra" });
  const memory = new Memory({
    storage,
    options: { lastMessages: 16, semanticRecall: false, workingMemory: { enabled: false } },
  });

  const agent = new Agent({
    id: AGENT_ID,
    name: "Asisten Lokerin",
    instructions: ({ requestContext }: { requestContext: RequestContext<LokerinRequestContext> }) => {
      const user = requestContext.get("user");
      const kanal = requestContext.get("kanal");
      return [UMUM, user?.role === "pemberi" ? PEMBERI : PENCARI, kanal === "suara" ? SUARA : ""].join("\n\n");
    },
    model: models.chat("low"),
    tools: ({ requestContext }: { requestContext: RequestContext<LokerinRequestContext> }) =>
      requestContext.get("user")?.role === "pemberi" ? tools.pemberi : tools.pencari,
    memory,
  });

  const mastra = new Mastra({ agents: { [AGENT_ID]: agent }, storage });
  return { mastra, agent, memory, storage };
}
