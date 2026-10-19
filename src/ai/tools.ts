import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { employers, lamaran, lowongan, personas, users, type JenisUpah } from "../db/schema.js";
import type { Models } from "./models.js";
import type { SessionUser } from "../auth/session.js";
import type { Env } from "../config/env.js";
import type { EventBus } from "../events/bus.js";
import { cariLowongan } from "../domain/matching.js";
import { buatDraf, employerOf, ubahDraf, type IsiDraf } from "../domain/lowongan.js";
import { profilInduk, simpanPersona, usulkanFakta } from "../domain/profil.js";
import { lamaranMasuk, lamaranPencari, lamaranUntuk, tandaiDilihat } from "../domain/lamaran.js";
import { revisiCvKhusus, siapkanCvKhusus, type HasilSiapkanCv } from "../cv/generate.js";
import { daftarKabar } from "../kabar/kabar.js";
import { kartuLowongan } from "../domain/serialize.js";

export type LokerinRequestContext = { user: SessionUser; kanal: "teks" | "suara" };

/**
 * One request, one run per CV: the result is shown to the person first instead of being polished
 * in a loop (each run used to draw its own card in the thread).
 */
function sekaliPerPermintaan(requestContext: RequestContext<unknown> | undefined, kunci: string) {
  const rc = requestContext as RequestContext<Record<string, unknown>> | undefined;
  let sudah = rc?.get("sudah_dikerjakan") as Set<string> | undefined;
  if (!sudah) {
    sudah = new Set();
    rc?.set("sudah_dikerjakan", sudah);
  }
  if (sudah.has(kunci)) return false;
  sudah.add(kunci);
  return true;
}

const CV_SUDAH_DIUBAH = {
  catatan: "CV ini sudah dikerjakan di permintaan ini dan hasilnya sudah tampil di layar. Jangan ubah lagi. Ringkas perubahannya dalam satu kalimat dan tanya apakah sudah pas.",
};

/** What the agent needs to talk about a CV, not the whole document (the card loads that itself). */
function ringkasCv(h: HasilSiapkanCv) {
  return {
    widget: "cv_khusus" as const,
    id: h.id,
    isi: { judul: h.isi.judul, ringkasan: h.isi.ringkasan },
    bagian: h.isi.bagian.map((b) => `${b.judul}: ${b.entri.map((e) => `${e.judul} (${e.poin.length} poin)`).join(", ")}`),
    keahlian: h.isi.keahlian.map((k) => k.label),
    bahasa: h.bahasa,
    fakta_dipakai: h.fakta_dipakai,
    poin_dibuang: h.poin_dibuang,
    peringatan: h.peringatan,
  };
}

function currentUser(requestContext: RequestContext<unknown> | undefined, role?: SessionUser["role"]) {
  const user = (requestContext as RequestContext<LokerinRequestContext> | undefined)?.get("user");
  if (!user) throw new Error("Sesi tidak ditemukan");
  if (role && user.role !== role) {
    throw new Error(role === "pemberi" ? "Alat ini khusus Pemberi Kerja." : "Alat ini khusus Pencari Kerja.");
  }
  return user;
}

function kanal(requestContext: RequestContext<unknown> | undefined) {
  return (requestContext as RequestContext<LokerinRequestContext> | undefined)?.get("kanal") ?? "teks";
}

const jenisUpah = z.enum(["harian", "mingguan", "bulanan", "borongan", "per_jam"]);

const isiDrafSchema = z.object({
  judul: z.string().optional().describe("Posisi, misalnya 'Juru Masak' atau 'Pembantu Rumah Tangga'"),
  kategori: z
    .enum([
      "kuliner", "toko_ritel", "bengkel", "konstruksi", "kebersihan", "rumah_tangga", "pengantaran",
      "pertanian", "produksi", "perawatan", "admin", "teknologi", "desain", "pemasaran", "lainnya",
    ])
    .optional(),
  segmen: z.enum(["informal", "magang"]).optional(),
  deskripsi: z.string().optional().describe("Tanggung jawab utama dalam 1-3 kalimat, sesuai ucapan Pemberi Kerja"),
  syarat: z.array(z.string()).optional(),
  jenis_upah: jenisUpah.optional(),
  upah_min: z.number().int().optional().describe("Dalam rupiah, misalnya 50000"),
  upah_max: z.number().int().optional(),
  jam_per_hari: z.number().optional(),
  hari_per_minggu: z.number().int().optional(),
  jam_kerja: z.string().optional().describe("Misalnya '07.00–15.00'"),
  jenis_kerja: z.enum(["harian", "paruh_waktu", "kontrak", "tetap", "magang"]).optional(),
  mulai: z.string().optional().describe("Tanggal mulai, format YYYY-MM-DD"),
  kota: z.string().optional(),
  kecamatan: z.string().optional(),
  alamat: z.string().optional(),
  butuh_hari_ini_jam: z.number().int().optional().describe("Isi bila lowongan mendadak untuk hari ini: berapa jam lagi ditutup"),
  bahasa: z.enum(["id", "en"]).optional(),
});

function toIsiDraf(input: z.infer<typeof isiDrafSchema>): IsiDraf {
  return {
    title: input.judul,
    category: input.kategori,
    segment: input.segmen,
    description: input.deskripsi,
    requirements: input.syarat,
    payType: input.jenis_upah as JenisUpah | undefined,
    payMin: input.upah_min,
    payMax: input.upah_max,
    hoursPerDay: input.jam_per_hari,
    daysPerWeek: input.hari_per_minggu,
    hoursText: input.jam_kerja,
    employmentType: input.jenis_kerja,
    startDate: input.mulai,
    city: input.kota,
    district: input.kecamatan,
    address: input.alamat,
    urgentHours: input.butuh_hari_ini_jam,
    language: input.bahasa,
  };
}

export type AlatDeps = { bus: EventBus; env: Env };

export function createTools(db: Db, models: Models, { bus, env }: AlatDeps) {
  const cari_lowongan = createTool({
    id: "cari_lowongan",
    description:
      "Mencari Lowongan yang sudah Terbit. Preferensi Wajib (lokasi, upah minimum) disaring lebih dulu. Selalu pakai alat ini sebelum menyebut lowongan apa pun; jangan mengarang lowongan.",
    inputSchema: z.object({
      kueri: z.string().optional().describe("Pekerjaan yang dicari dengan kata-kata pengguna"),
      kota: z.array(z.string()).optional().describe("Kota atau kecamatan, misalnya ['Purwokerto']"),
      kategori: z.string().optional(),
      segmen: z.enum(["informal", "magang"]).optional(),
      jenis_upah: jenisUpah.optional(),
      upah_min_harian: z.number().int().optional().describe("Isi bila pengguna menyebut upah minimal per hari, misalnya 100000"),
      upah_min_bulanan: z.number().int().optional().describe("Isi bila pengguna menyebut upah minimal per bulan"),
      butuh_hari_ini: z.boolean().optional().describe("true untuk lowongan mendadak hari ini"),
      persona_id: z
        .string()
        .optional()
        .describe("Persona untuk menilai kecocokan; bila kosong, Persona yang paling mirip dengan kueri dipilih otomatis"),
    }),
    execute: async ({ upah_min_harian, ...input }, context) => {
      const user = context.requestContext ? currentUser(context.requestContext) : null;
      const hasil = await cariLowongan(db, models, user?.id ?? null, {
        ...input,
        upah_min_bulanan: input.upah_min_bulanan ?? (upah_min_harian ? Math.round(upah_min_harian * 6 * 4.33) : undefined),
      });
      return { widget: "daftar_lowongan" as const, ...hasil };
    },
  });

  const detail_lowongan = createTool({
    id: "detail_lowongan",
    description: "Mengambil rincian satu Lowongan beserta lencana verifikasi Pemberi Kerja.",
    inputSchema: z.object({ lowongan_id: z.string() }),
    execute: async ({ lowongan_id }) => {
      const row = await db
        .select({ lowongan, employer: employers })
        .from(lowongan)
        .innerJoin(employers, eq(employers.id, lowongan.employerId))
        .where(and(eq(lowongan.id, lowongan_id), eq(lowongan.status, "terbit")))
        .then((rows) => rows[0]);
      if (!row) return { widget: "galat" as const, pesan: "Lowongan tidak ditemukan." };
      return { widget: "detail_lowongan" as const, lowongan: kartuLowongan(row.lowongan, row.employer) };
    },
  });

  const lihat_profil = createTool({
    id: "lihat_profil",
    description: "Membaca Profil Induk Pencari Kerja: Fakta (terkonfirmasi dan usulan) serta Persona.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const user = currentUser(context.requestContext, "pencari");
      return { widget: "profil_induk" as const, ...(await profilInduk(db, user.id)) };
    },
  });

  const usulkan_fakta = createTool({
    id: "usulkan_fakta",
    description:
      "Mengusulkan Fakta baru dari cerita pengguna. Fakta BELUM tersimpan: pengguna harus mengetuk tombol konfirmasi di layar. " +
      "Satu pekerjaan (satu posisi di satu tempat), satu pendidikan, atau satu proyek adalah SATU Fakta. Tugas, tanggung jawab, dan hasil di dalamnya " +
      "(termasuk angka seperti target atau KPI) masuk ke `poin` Fakta itu, bukan Fakta terpisah. Jenis 'prestasi' hanya untuk penghargaan, juara, atau " +
      "sertifikat yang berdiri sendiri; 'keahlian' hanya untuk kemampuan yang disebut sebagai kemampuan (alat, bahasa, mesin). Jangan menambah apa pun " +
      "yang tidak diucapkan.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            jenis: z.enum(["pengalaman", "keahlian", "pendidikan", "prestasi", "lainnya"]),
            judul: z.string().describe("Posisi atau nama, misalnya 'Marcomm Intern' atau 'Tukang las pagar'"),
            tempat: z.string().optional().describe("Usaha, perusahaan, sekolah, atau organisasi"),
            periode: z.string().optional().describe("Misalnya 'Jan–Jun 2026', '2019–sekarang', atau '6 tahun'"),
            poin: z
              .array(z.string())
              .max(8)
              .optional()
              .describe("Tugas dan hasil di pengalaman ini, satu kalimat pendek per poin, dengan kata-kata pengguna"),
            detail: z.string().optional().describe("Catatan lain yang bukan tugas atau hasil"),
          }),
        )
        .min(1)
        .max(8),
    }),
    execute: async ({ items }, context) => {
      const user = currentUser(context.requestContext, "pencari");
      const usulan = await usulkanFakta(db, user.id, items, kanal(context.requestContext) === "suara" ? "suara" : "obrolan");
      return {
        widget: "konfirmasi_fakta" as const,
        usulan,
        catatan: "Belum tersimpan. Minta pengguna mengetuk Simpan pada Fakta yang benar.",
      };
    },
  });

  const simpan_persona = createTool({
    id: "simpan_persona",
    description:
      "Membuat atau memperbarui Persona dari Fakta yang SUDAH terkonfirmasi. Satu orang bisa punya beberapa Persona, misalnya 'Tukang Las' dan 'Driver Ojol'.",
    inputSchema: z.object({
      persona_id: z.string().optional().describe("Isi untuk memperbarui Persona yang ada"),
      judul: z.string(),
      ringkasan: z.string(),
      keahlian: z.array(z.string()),
      fakta_ids: z.array(z.string()).describe("ID Fakta terkonfirmasi yang mendukung Persona ini"),
      preferensi: z
        .object({
          kota: z.array(z.string()),
          upah_min: z.number().int().optional(),
          upah_satuan: z.enum(["harian", "bulanan"]).optional(),
          mulai: z.string().optional(),
          jenis_kerja: z.array(z.string()).optional(),
          mau_pindah: z.boolean().optional(),
        })
        .optional(),
    }),
    execute: async ({ persona_id, ...isi }, context) => {
      const user = currentUser(context.requestContext, "pencari");
      const persona = await simpanPersona(db, models, user.id, isi, persona_id);
      return { widget: "persona" as const, persona };
    },
  });

  const siapkan_cv_khusus = createTool({
    id: "siapkan_cv_khusus",
    description:
      "Menyusun CV Khusus untuk satu Lowongan dari satu Persona, hanya dari Fakta terkonfirmasi. Hasilnya dibuka di editor; pengguna boleh mengedit lalu menyetujuinya. Panggil sekali per permintaan.",
    inputSchema: z.object({
      lowongan_id: z.string(),
      persona_id: z.string(),
      template: z.enum(["satu_kolom", "dua_kolom"]).optional(),
    }),
    execute: async (input, context) => {
      const user = currentUser(context.requestContext, "pencari");
      if (!sekaliPerPermintaan(context.requestContext, `siapkan:${input.lowongan_id}:${input.persona_id}`)) return CV_SUDAH_DIUBAH;
      return ringkasCv(await siapkanCvKhusus(db, models, user.id, input));
    },
  });

  const siapkan_lamaran = createTool({
    id: "siapkan_lamaran",
    description:
      "Menyiapkan kartu Lamaran untuk dikirim. Alat ini TIDAK mengirim Lamaran: pengguna mengirimnya sendiri dengan tombol Kirim Lamaran.",
    inputSchema: z.object({
      lowongan_id: z.string(),
      persona_id: z.string(),
      cv_khusus_id: z.string().optional(),
      pesan: z.string().optional().describe("Pesan singkat untuk Pemberi Kerja, dari kata-kata pengguna"),
    }),
    execute: async (input, context) => {
      const user = currentUser(context.requestContext, "pencari");
      const target = await db
        .select({ lowongan, employer: employers })
        .from(lowongan)
        .innerJoin(employers, eq(employers.id, lowongan.employerId))
        .where(and(eq(lowongan.id, input.lowongan_id), eq(lowongan.status, "terbit")))
        .then((rows) => rows[0]);
      const persona = await db.query.personas.findFirst({
        where: and(eq(personas.id, input.persona_id), eq(personas.userId, user.id)),
      });
      if (!target || !persona) return { widget: "galat" as const, pesan: "Lowongan atau kerja yang dipilih tidak ditemukan." };
      const sudah = await db.query.lamaran.findFirst({
        where: and(eq(lamaran.lowonganId, input.lowongan_id), eq(lamaran.pencariId, user.id)),
      });
      return {
        widget: "lamaran_siap" as const,
        lowongan: kartuLowongan(target.lowongan, target.employer),
        persona: { id: persona.id, judul: persona.title },
        cv_khusus_id: input.cv_khusus_id ?? null,
        pesan: input.pesan ?? null,
        sudah_melamar: Boolean(sudah),
        peringatan:
          !input.cv_khusus_id && target.lowongan.segment === "magang"
            ? "Lowongan magang biasanya membaca CV. Lamaranmu lebih kuat dengan CV lamaran."
            : null,
        tombol: { label: "Kirim Lamaran", method: "POST", path: "/lamaran" },
      };
    },
  });

  const status_lamaran = createTool({
    id: "status_lamaran",
    description: "Melihat semua Lamaran milik Pencari Kerja beserta status dan Tahap Berikutnya.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const user = currentUser(context.requestContext, "pencari");
      return { widget: "daftar_lamaran" as const, lamaran: await lamaranPencari(db, user.id) };
    },
  });

  const buat_draf_lowongan = createTool({
    id: "buat_draf_lowongan",
    description:
      "Membuat Draf Lowongan dari ucapan Pemberi Kerja, lalu menjalankan Pemeriksaan. Isi hanya yang disebutkan; yang kosong akan muncul di Pemeriksaan. Draf belum bisa dilihat Pencari Kerja sampai Pemberi Kerja mengetuk Terbitkan.",
    inputSchema: isiDrafSchema,
    execute: async (input, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      return { widget: "draf_lowongan" as const, lowongan: await buatDraf(db, user.id, toIsiDraf(input)) };
    },
  });

  const ubah_draf_lowongan = createTool({
    id: "ubah_draf_lowongan",
    description:
      "Mengubah sebagian Draf Lowongan (misalnya 'ubah gajinya jadi 70 ribu'), lalu menjalankan Pemeriksaan ulang. Kirim hanya field yang berubah.",
    inputSchema: isiDrafSchema.extend({ lowongan_id: z.string() }),
    execute: async ({ lowongan_id, ...input }, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      return { widget: "draf_lowongan" as const, lowongan: await ubahDraf(db, user.id, lowongan_id, toIsiDraf(input)) };
    },
  });

  const lowongan_saya = createTool({
    id: "lowongan_saya",
    description:
      "Melihat Lowongan milik Pemberi Kerja (draf dan terbit) beserta jumlah Lamaran. Isi lowongan_id untuk membuka satu kartu Lowongan; dari kartu itu pengguna bisa mengetuk Terbitkan atau Tutup lowongan.",
    inputSchema: z.object({ lowongan_id: z.string().optional().describe("Isi untuk membuka satu Lowongan") }),
    execute: async ({ lowongan_id }, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      const employer = await employerOf(db, user.id);
      const rows = await db
        .select({ lowongan, jumlah: count(lamaran.id) })
        .from(lowongan)
        .leftJoin(lamaran, eq(lamaran.lowonganId, lowongan.id))
        .where(and(eq(lowongan.employerId, employer.id), ...(lowongan_id ? [eq(lowongan.id, lowongan_id)] : [])))
        .groupBy(lowongan.id)
        .orderBy(desc(lowongan.updatedAt));
      if (lowongan_id) {
        const row = rows[0];
        if (!row) return { widget: "galat" as const, pesan: "Lowongan itu tidak ditemukan di akunmu." };
        return { widget: "draf_lowongan" as const, lowongan: kartuLowongan(row.lowongan, employer, { jumlah_lamaran: Number(row.jumlah) }) };
      }
      return {
        widget: "lowongan_saya" as const,
        lowongan: rows.map((row) => kartuLowongan(row.lowongan, employer, { jumlah_lamaran: Number(row.jumlah) })),
      };
    },
  });

  const lamaran_masuk = createTool({
    id: "lamaran_masuk",
    description: "Melihat Lamaran yang masuk ke Lowongan milik Pemberi Kerja. Kontak pelamar tersembunyi sampai Lamaran Lolos.",
    inputSchema: z.object({ lowongan_id: z.string().optional() }),
    execute: async ({ lowongan_id }, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      return { widget: "lamaran_masuk" as const, lamaran: await lamaranMasuk(db, user.id, lowongan_id) };
    },
  });

  // --- Alat dari ADR 0008 ---

  const tanya_pengguna = createTool({
    id: "tanya_pengguna",
    description: [
      "Bertanya kepada pengguna dengan pilihan jawaban yang tampil sebagai tombol besar. Pakai saat jawaban yang kamu butuhkan punya pilihan yang jelas,",
      "misalnya shift (pagi/siang/malam), jenis upah, Persona mana yang dipakai, atau lowongan mana yang dimaksud.",
      "Jangan pakai untuk isian bebas seperti nama, nomor, atau alamat; tanyakan itu biasa. Jangan pakai untuk konfirmasi aksi final.",
      "Setelah memanggil alat ini, BERHENTI dan tunggu. Jawaban pengguna datang sebagai pesan berikutnya.",
    ].join(" "),
    inputSchema: z.object({
      pertanyaan: z.string().min(3).max(140).describe("Satu pertanyaan pendek, misalnya 'Kamu bisa kerja jam berapa?'"),
      pilihan: z
        .array(
          z.object({
            label: z.string().min(1).max(40).describe("Teks tombol, singkat"),
            keterangan: z.string().max(80).optional().describe("Penjelasan kecil di bawah tombol bila perlu"),
          }),
        )
        .min(2)
        .max(6),
      boleh_banyak: z.boolean().optional().describe("true bila pengguna boleh memilih lebih dari satu"),
      boleh_ketik: z.boolean().optional().describe("true bila pengguna boleh menjawab dengan kata-katanya sendiri"),
    }),
    execute: async (input) => ({
      widget: "pertanyaan" as const,
      id: randomUUID(),
      pertanyaan: input.pertanyaan,
      pilihan: input.pilihan,
      boleh_banyak: input.boleh_banyak ?? false,
      boleh_ketik: input.boleh_ketik ?? false,
    }),
  });

  const ubah_cv_khusus = createTool({
    id: "ubah_cv_khusus",
    description:
      "Merevisi CV Khusus yang sudah ada sesuai permintaan pengguna, misalnya 'ringkasan lebih pendek' atau 'tonjolkan pengalaman kasir'. Tetap hanya memakai Fakta terkonfirmasi; permintaan yang butuh isi baru diabaikan, jadi sarankan pengguna menceritakan pengalaman itu dulu. " +
      "Panggil SEKALI per permintaan pengguna dengan instruksi yang lengkap; hasilnya langsung tampil. Jangan memanggil ulang untuk menyempurnakan sendiri.",
    inputSchema: z.object({
      cv_id: z.string().describe("ID CV Khusus dari hasil siapkan_cv_khusus"),
      instruksi: z.string().min(3).max(300).describe("Permintaan pengguna dengan kata-katanya sendiri"),
    }),
    execute: async (input, context) => {
      const user = currentUser(context.requestContext, "pencari");
      if (!sekaliPerPermintaan(context.requestContext, `ubah:${input.cv_id}`)) return CV_SUDAH_DIUBAH;
      return ringkasCv(await revisiCvKhusus(db, models, user.id, input));
    },
  });

  const kartu_kerja = createTool({
    id: "kartu_kerja",
    description:
      "Menampilkan Kartu Kerja satu Persona beserta tautan untuk dibagikan, misalnya ke status WhatsApp. Tanpa persona_id, Persona pertama dipakai.",
    inputSchema: z.object({ persona_id: z.string().optional() }),
    execute: async ({ persona_id }, context) => {
      const user = currentUser(context.requestContext, "pencari");
      const persona = await db.query.personas.findFirst({
        where: and(eq(personas.userId, user.id), ...(persona_id ? [eq(personas.id, persona_id)] : [])),
      });
      if (!persona) return { widget: "galat" as const, pesan: "Lokerin belum tahu kamu bisa kerja apa. Ceritakan pengalaman kerjamu dulu supaya Kartu Kerja bisa dibuat." };
      const pemilik = await db.query.users.findFirst({ where: eq(users.id, user.id) });
      return {
        widget: "kartu_kerja" as const,
        kartu: {
          id: persona.id,
          nama: pemilik?.name ?? "",
          kota: pemilik?.district ?? pemilik?.city ?? "",
          judul: persona.title,
          ringkasan: persona.summary,
          keahlian: persona.skills,
          tautan: `${env.PUBLIC_WEB_URL}/kartu/${persona.id}`,
        },
      };
    },
  });

  const siapkan_laporan = createTool({
    id: "siapkan_laporan",
    description:
      "Menyiapkan laporan untuk Lowongan yang mencurigakan, misalnya meminta biaya di depan, upah tidak masuk akal, atau alamat tidak jelas. Laporan baru terkirim setelah pengguna mengetuk Kirim laporan di kartu.",
    inputSchema: z.object({
      lowongan_id: z.string(),
      alasan: z.string().min(3).max(300).describe("Alasan dengan kata-kata pengguna, misalnya 'diminta bayar 200 ribu untuk seragam'"),
    }),
    execute: async ({ lowongan_id, alasan }) => {
      const row = await db
        .select({ lowongan, employer: employers })
        .from(lowongan)
        .innerJoin(employers, eq(employers.id, lowongan.employerId))
        .where(eq(lowongan.id, lowongan_id))
        .then((rows) => rows[0]);
      if (!row) return { widget: "galat" as const, pesan: "Lowongan tidak ditemukan." };
      return {
        widget: "laporan_siap" as const,
        lowongan: { id: row.lowongan.id, judul: row.lowongan.title, nama_usaha: row.employer.businessName },
        alasan,
      };
    },
  });

  const lihat_kabar = createTool({
    id: "lihat_kabar",
    description: "Melihat Kabar terbaru pengguna (Lamaran masuk, Lamaran Lolos, Butuh Hari Ini di dekatnya) dan berapa yang belum dibaca.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const user = currentUser(context.requestContext);
      return { widget: "daftar_kabar" as const, ...(await daftarKabar(db, user.id, 10)) };
    },
  });

  const lihat_pelamar = createTool({
    id: "lihat_pelamar",
    description:
      "Membuka satu Lamaran yang masuk beserta Persona dan CV Khusus pelamar, dan menandainya Dilihat. Kontak pelamar tetap tersembunyi sampai Lolos. Dari kartunya pengguna bisa mengetuk Loloskan atau Tidak lolos.",
    inputSchema: z.object({ lamaran_id: z.string().describe("ID Lamaran dari hasil lamaran_masuk") }),
    execute: async ({ lamaran_id }, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      return { widget: "pelamar" as const, lamaran: await tandaiDilihat(db, bus, user.id, lamaran_id) };
    },
  });

  const siapkan_tahap = createTool({
    id: "siapkan_tahap",
    description: [
      "Menyiapkan Tahap Berikutnya untuk satu pelamar: meloloskan Lamaran beserta instruksinya, atau menambah tahap untuk Lamaran yang sudah Lolos.",
      "Contoh: 'loloskan Sari, suruh chat WA 0812...'. Kartu yang tampil berisi tombol Kirim ke pelamar; Lolos baru terjadi setelah pengguna mengetuknya.",
      "Bila jenis atau rincian belum jelas, tanyakan dulu (boleh dengan tanya_pengguna untuk jenisnya).",
    ].join(" "),
    inputSchema: z.object({
      lamaran_id: z.string(),
      jenis: z.enum(["whatsapp", "meet", "alamat", "lainnya"]).describe("whatsapp: nomor WA; meet: tautan wawancara online; alamat: datang ke tempat"),
      detail: z.string().min(3).max(300).describe("Nomor WhatsApp, tautan, atau alamat persis seperti disebut pengguna"),
      jadwal: z.string().optional().describe("Waktu, format ISO 8601 bila disebut"),
      catatan: z.string().max(300).optional().describe("Misalnya 'bawa KTP'"),
    }),
    execute: async ({ lamaran_id, ...tahap }, context) => {
      const user = currentUser(context.requestContext, "pemberi");
      const kartu = await lamaranUntuk(db, user.id, "pemberi", lamaran_id);
      if (!kartu) return { widget: "galat" as const, pesan: "Lamaran tidak ditemukan." };
      if (kartu.status === "tidak_lolos") return { widget: "galat" as const, pesan: "Lamaran ini sudah ditandai Tidak lolos." };
      return {
        widget: "tahap_siap" as const,
        mode: kartu.status === "lolos" ? ("tambah" as const) : ("lolos" as const),
        lamaran: kartu,
        tahap,
      };
    },
  });

  return {
    pencari: {
      cari_lowongan,
      detail_lowongan,
      lihat_profil,
      usulkan_fakta,
      simpan_persona,
      siapkan_cv_khusus,
      ubah_cv_khusus,
      siapkan_lamaran,
      status_lamaran,
      kartu_kerja,
      siapkan_laporan,
      lihat_kabar,
      tanya_pengguna,
    },
    pemberi: {
      buat_draf_lowongan,
      ubah_draf_lowongan,
      lowongan_saya,
      lamaran_masuk,
      lihat_pelamar,
      siapkan_tahap,
      cari_lowongan,
      detail_lowongan,
      lihat_kabar,
      tanya_pengguna,
    },
  };
}
