/**
 * Evaluasi pemilihan alat agen (ADR 0008): `pnpm eval:agen`.
 *
 * Setiap skenario dijalankan dengan instruksi agen yang sama, tetapi alatnya tiruan, jadi tidak ada yang
 * ditulis ke database. Yang diperiksa hanya alat yang dipilih agen. Tambah skenario setiap kali agen
 * salah pilih alat di percakapan nyata.
 */
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { loadEnv } from "../config/env.js";
import { createModels } from "../ai/models.js";
import { instruksiAgen } from "../ai/agent.js";
import { createTools, type LokerinRequestContext } from "../ai/tools.js";
import type { Db } from "../db/client.js";
import { EventBus } from "../events/bus.js";

type Skenario = {
  nama: string;
  peran: "pencari" | "pemberi";
  pesan: string;
  harus: string[];
  tidakBoleh?: string[];
};

const SKENARIO: Skenario[] = [
  { nama: "cerita pengalaman jadi Fakta", peran: "pencari", pesan: "Aku udah 3 tahun jadi kasir di Indomaret Sokaraja", harus: ["usulkan_fakta"] },
  { nama: "cari kerja", peran: "pencari", pesan: "Cariin kerja kasir di Purwokerto dong", harus: ["cari_lowongan"] },
  {
    nama: "pilihan shift lewat tombol",
    peran: "pencari",
    pesan: "Aku mau cari kerja jaga toko. Tapi aku belum tahu enaknya ambil shift apa, bantu tanyain aku dong",
    harus: ["tanya_pengguna"],
  },
  {
    nama: "lowongan minta biaya dilaporkan",
    peran: "pencari",
    pesan: "Lowongan l-1 minta aku transfer 200 ribu buat seragam dulu sebelum mulai kerja, gimana nih?",
    harus: ["siapkan_laporan"],
    tidakBoleh: ["siapkan_lamaran"],
  },
  { nama: "revisi CV Khusus", peran: "pencari", pesan: "Ringkasan di CV khusus cv-1 kepanjangan, pendekin jadi dua kalimat aja", harus: ["ubah_cv_khusus"] },
  { nama: "bagikan Kartu Kerja", peran: "pencari", pesan: "Aku mau share kartu kerjaku ke status WA", harus: ["kartu_kerja"] },
  { nama: "kabar terbaru", peran: "pencari", pesan: "Ada kabar baru buat aku nggak?", harus: ["lihat_kabar"] },
  { nama: "lamar hanya disiapkan", peran: "pencari", pesan: "Lamarin aku ke lowongan l-1 pakai CV Kasir sekarang juga", harus: ["siapkan_lamaran"] },
  {
    nama: "draf dari cerita",
    peran: "pemberi",
    pesan: "Butuh tukang cuci piring, 70 ribu sehari, jam 8 pagi sampai 4 sore, di Purwokerto Utara",
    harus: ["buat_draf_lowongan"],
  },
  { nama: "lihat pelamar", peran: "pemberi", pesan: "Siapa aja yang udah ngelamar ke lowonganku?", harus: ["lamaran_masuk"] },
  {
    nama: "loloskan dengan tahap",
    peran: "pemberi",
    pesan: "Loloskan Sari Wulandari, suruh chat WA ke 0812 3456 7890 buat atur jadwal wawancara",
    harus: ["siapkan_tahap"],
  },
  { nama: "buka satu lowongan untuk ditutup", peran: "pemberi", pesan: "Tutup lowongan l-9 dong, udah dapet orang", harus: ["lowongan_saya"] },
];

/** Hasil tiruan secukupnya agar agen bisa merangkai alat, misalnya lamaran_masuk lalu siapkan_tahap. */
function hasilTiruan(alat: string): Record<string, unknown> {
  switch (alat) {
    case "lihat_profil":
      return {
        widget: "profil_induk",
        persona: [{ id: "p-1", judul: "Kasir" }],
        fakta: [{ id: "f-1", judul: "Kasir di Indomaret Sokaraja", status: "terkonfirmasi" }],
      };
    case "cari_lowongan":
      return { widget: "daftar_lowongan", hasil: [{ lowongan: { id: "l-1", judul: "Kasir Toko Sembako", kota: "Purwokerto" }, skor: 82 }] };
    case "detail_lowongan":
      return {
        widget: "detail_lowongan",
        lowongan: { id: "l-1", judul: "Kasir Toko Sembako", segmen: "informal", status: "terbit", upah: { label: "Rp90.000/hari" } },
      };
    case "lamaran_masuk":
      return {
        widget: "lamaran_masuk",
        lamaran: [{ id: "lam-1", status: "dilihat", pencari: { nama: "Sari Wulandari" }, lowongan: { id: "l-2", judul: "Pelayan & Kasir" } }],
      };
    default:
      return { widget: alat, ok: true, catatan: "hasil uji" };
  }
}

async function main() {
  const env = loadEnv();
  const models = createModels(env);
  // Alat asli hanya dipakai untuk nama, deskripsi, dan skema; eksekusinya diganti.
  const asli = createTools({} as Db, models, { bus: new EventBus(), env });
  let panggilan: string[] = [];
  const tiru = (alat: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(alat).map(([nama, tool]) => {
        const t = tool as { id: string; description: string; inputSchema: never };
        return [
          nama,
          createTool({
            id: t.id,
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async () => {
              panggilan.push(t.id);
              return hasilTiruan(t.id);
            },
          }),
        ];
      }),
    );
  const alat = { pencari: tiru(asli.pencari), pemberi: tiru(asli.pemberi) };

  const agent = new Agent({
    id: "lokerin-eval",
    name: "Asisten Lokerin (eval)",
    instructions: instruksiAgen,
    model: models.chat("low"),
    tools: ({ requestContext }: { requestContext: RequestContext<LokerinRequestContext> }) =>
      requestContext.get("user")?.role === "pemberi" ? alat.pemberi : alat.pencari,
  });

  let gagal = 0;
  for (const skenario of SKENARIO) {
    panggilan = [];
    const requestContext = new RequestContext<LokerinRequestContext>();
    requestContext.set("user", { id: "00000000-0000-0000-0000-000000000000", role: skenario.peran });
    requestContext.set("kanal", "teks");
    try {
      await agent.generate(skenario.pesan, { requestContext, maxSteps: 4 });
    } catch (galat) {
      panggilan.push(`(galat: ${(galat as Error).message})`);
    }
    const kurang = skenario.harus.filter((nama) => !panggilan.includes(nama));
    const terlarang = (skenario.tidakBoleh ?? []).filter((nama) => panggilan.includes(nama));
    const lolos = !kurang.length && !terlarang.length;
    if (!lolos) gagal++;
    console.log(
      `${lolos ? "LOLOS" : "GAGAL"}  ${skenario.nama.padEnd(34)} ${panggilan.join(" → ") || "(tanpa alat)"}${
        kurang.length ? `  | kurang: ${kurang.join(", ")}` : ""
      }${terlarang.length ? `  | terlarang: ${terlarang.join(", ")}` : ""}`,
    );
  }
  console.log(`\n${SKENARIO.length - gagal}/${SKENARIO.length} skenario lolos`);
  process.exit(gagal ? 1 : 0);
}

void main();
