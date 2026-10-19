import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { cvKhusus, employers, fakta, lowongan, personas, users, type BagianCv, type IsiCv } from "../db/schema.js";
import type { Models } from "../ai/models.js";
import { HttpError } from "../auth/session.js";
import { normalisasiIsi, teksPerId } from "./isi.js";

const poinSchema = z.object({
  text: z
    .string()
    .describe("Satu poin: kata kerja di depan, konkret, satu kalimat. Boleh **tebal** untuk angka atau hasil yang ADA di Fakta."),
  fakta_ids: z.array(z.string()).describe("ID Fakta asal poin ini; wajib minimal satu"),
});

const draftSchema = z.object({
  judul: z.string().describe("Judul profesional singkat yang sesuai Lowongan, misalnya 'Juru Masak' atau 'UI/UX Designer'"),
  ringkasan: z
    .string()
    .describe("2-3 kalimat, hanya dari Fakta. Boleh **tebal** untuk 1-3 kata kunci yang dicari Lowongan."),
  keahlian: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            "Nama bidang, bukan nama alat. Benar: {label:'Desain', isi:['Figma','Wireframe']}. Salah: {label:'Figma', isi:[...]}. Contoh label: Dapur, Kasir & Toko, Desain, Riset Pengguna, Alat, Bahasa",
          ),
        isi: z.array(z.string()).describe("Keahlian dalam kelompok ini, dari Fakta"),
      }),
    )
    .describe("2-4 kelompok keahlian; setiap kelompok berisi 2-8 keahlian"),
  bagian: z.array(
    z.object({
      jenis: z.enum(["pengalaman", "pendidikan", "proyek", "prestasi", "lainnya"]),
      judul: z.string().describe("Nama jenis bagian (Pengalaman, Pendidikan, Proyek, Prestasi), bukan nama entri"),
      entri: z.array(
        z.object({
          judul: z.string().describe("Posisi, nama sekolah, atau nama proyek, persis dari judul Fakta"),
          tempat: z.string().optional().describe("Usaha, organisasi, atau jurusan dari tempat Fakta"),
          keterangan: z.string().optional().describe("Catatan pendek bila ada di Fakta, misalnya 'paruh waktu'"),
          periode: z.string().optional().describe("Periode dari Fakta, misalnya '2021 – sekarang'"),
          lokasi: z.string().optional(),
          fakta_ids: z.array(z.string()).describe("ID Fakta yang menjadi dasar entri ini; wajib minimal satu"),
          poin: z.array(poinSchema).describe("0-4 poin dari poin Fakta"),
        }),
      ),
    }),
  ),
});

export type HasilSiapkanCv = {
  id: string;
  isi: IsiCv;
  template: "satu_kolom" | "dua_kolom";
  bahasa: "id" | "en";
  fakta_dipakai: number;
  poin_dibuang: number;
  peringatan: string | null;
};

type Sumber = {
  user: typeof users.$inferSelect;
  persona: typeof personas.$inferSelect;
  target: { lowongan: typeof lowongan.$inferSelect; employer: typeof employers.$inferSelect };
  fakta: (typeof fakta.$inferSelect)[];
};

async function muatSumber(db: Db, userId: string, personaId: string, lowonganId: string): Promise<Sumber> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const persona = await db.query.personas.findFirst({
    where: and(eq(personas.id, personaId), eq(personas.userId, userId)),
  });
  const target = await db
    .select({ lowongan, employer: employers })
    .from(lowongan)
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(eq(lowongan.id, lowonganId))
    .then((rows) => rows[0]);
  if (!user || !persona) throw new HttpError(404, "persona_tidak_ada", "Kerja yang dipilih tidak ditemukan.");
  if (!target) throw new HttpError(404, "lowongan_tidak_ada", "Lowongan tidak ditemukan.");

  const sumber = await db
    .select()
    .from(fakta)
    .where(
      and(
        eq(fakta.userId, userId),
        eq(fakta.status, "terkonfirmasi"),
        ...(persona.faktaIds.length ? [inArray(fakta.id, persona.faktaIds)] : []),
      ),
    );
  if (!sumber.length) {
    throw new HttpError(
      400,
      "fakta_kosong",
      "Belum ada bahan CV untuk kerja ini. Ceritakan pengalamanmu dulu, lalu ketuk Simpan pada yang benar.",
    );
  }
  return { user, persona, target, fakta: sumber };
}

/**
 * Inti penyusunan: model hanya boleh memakai Fakta di daftar, dan poin tanpa Fakta yang sah dibuang.
 * Dengan `revisi`, CV yang ada diubah sesuai instruksi pengguna dengan aturan yang sama.
 */
async function susunIsi(models: Models, sumber: Sumber, revisi?: { instruksi: string; isi: IsiCv }) {
  const { user, persona, target } = sumber;
  const bahasa = target.lowongan.language;
  const daftarFakta = sumber.fakta
    .map((item) =>
      [
        `- id: ${item.id}`,
        `  jenis: ${item.kind}`,
        `  judul: ${item.title}`,
        item.place ? `  tempat: ${item.place}` : null,
        item.period ? `  periode: ${item.period}` : null,
        item.detail ? `  poin:\n${item.detail.split("\n").map((baris) => `    - ${baris}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  const cvSekarang = revisi
    ? [
        `Judul: ${revisi.isi.judul}`,
        `Ringkasan: ${revisi.isi.ringkasan}`,
        `Keahlian: ${revisi.isi.keahlian.map((k) => `${k.label}: ${k.isi.join(", ")}`).join("; ")}`,
        ...revisi.isi.bagian.map(
          (bagian) =>
            `${bagian.judul}:\n${bagian.entri
              .map((e) => `- ${[e.judul, e.tempat, e.periode].filter(Boolean).join(", ")}\n${e.poin.map((p) => `  • ${p.text}`).join("\n")}`)
              .join("\n")}`,
        ),
      ].join("\n")
    : "";

  const { object } = await generateObject({
    model: models.chat("none"),
    schema: draftSchema,
    system: [
      bahasa === "en"
        ? "LANGUAGE: write the whole CV in English, including every section title (Experience, Education, Projects, Awards)."
        : "BAHASA: tulis seluruh CV dalam Bahasa Indonesia, termasuk semua judul bagian (Pengalaman, Pendidikan, Proyek, Prestasi).",
      "Kamu menyusun CV Khusus untuk satu Lamaran di Lokerin, dengan gaya CV yang disukai perekrut: rapi, padat, dan mudah dipindai.",
      "ATURAN MUTLAK: hanya gunakan Fakta di daftar. Boleh meringkas, mengurutkan ulang, dan merapikan bahasa, tetapi DILARANG menambah pengalaman, angka, nama tempat, tanggal, atau keahlian yang tidak ada di Fakta.",
      "Satu Fakta pengalaman, pendidikan, proyek, atau prestasi menjadi satu Entri: judul dari judul Fakta, tempat dari tempat Fakta, periode dari periode Fakta. Poin Fakta menjadi 1-4 poin Entri.",
      "Setiap Entri dan setiap poin wajib mencantumkan fakta_ids sumbernya, hanya di kolom fakta_ids. Jangan pernah menulis ID Fakta di dalam teks.",
      "Urutkan Entri dari yang paling relevan dengan Lowongan. Fakta yang tidak relevan boleh dilewati.",
      "Fakta keahlian masuk ke kelompok keahlian, bukan Entri. Kelompokkan per bidang (misalnya Desain, Riset, Alat), jangan menamai kelompok dengan nama satu alat.",
      ...(revisi
        ? ["Ubah CV yang ada sesuai instruksi pengguna. Bila instruksi meminta isi yang tidak ada di Fakta, abaikan bagian itu dan jangan mengarangnya."]
        : []),
      bahasa === "en" ? "Fakta may be in Indonesian; translate faithfully without adding anything." : "Gunakan Bahasa Indonesia yang baku tetapi sederhana.",
    ].join("\n"),
    prompt: [
      `Lowongan: ${target.lowongan.title} di ${target.employer.businessName} (${target.lowongan.city ?? ""})`,
      `Deskripsi: ${target.lowongan.description}`,
      `Syarat: ${target.lowongan.requirements.join("; ")}`,
      `Persona: ${persona.title}. ${persona.summary}`,
      "Fakta:",
      daftarFakta,
      ...(revisi ? ["", "CV saat ini:", cvSekarang, "", `Instruksi pengguna: ${revisi.instruksi}`] : []),
    ].join("\n"),
  });

  const sah = new Set(sumber.fakta.map((item) => item.id));
  // Models sometimes echo "[<uuid>]" into the text; it never belongs on a CV.
  const rapikan = (teks: string) =>
    teks
      .replace(/\s*[[(][0-9a-f]{8}-[0-9a-f-]{27,}[\])]/gi, "")
      .replace(/^\s*(?:[>\-*•]+\s*)+/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  const saring = (ids: string[]) => ids.filter((faktaId) => sah.has(faktaId));
  let dibuang = 0;
  const bagian: BagianCv[] = object.bagian
    .map((section) => ({
      id: randomUUID(),
      judul: section.judul,
      jenis: section.jenis,
      entri: section.entri
        .map((entri) => ({ ...entri, fakta_ids: saring(entri.fakta_ids) }))
        .filter((entri) => {
          const ok = entri.fakta_ids.length > 0 && entri.judul.trim().length > 0;
          if (!ok) dibuang++;
          return ok;
        })
        .map((entri) => ({
          id: randomUUID(),
          judul: rapikan(entri.judul),
          // "Freelance, Freelance": a place that repeats the title adds nothing.
          ...(entri.tempat?.trim() && rapikan(entri.tempat).toLowerCase() !== rapikan(entri.judul).toLowerCase() ? { tempat: rapikan(entri.tempat) } : {}),
          ...(entri.keterangan?.trim() ? { keterangan: entri.keterangan.trim() } : {}),
          ...(entri.periode?.trim() ? { periode: entri.periode.trim() } : {}),
          ...(entri.lokasi?.trim() ? { lokasi: entri.lokasi.trim() } : {}),
          fakta_ids: entri.fakta_ids,
          poin: entri.poin
            .map((poin) => ({ ...poin, text: rapikan(poin.text), fakta_ids: saring(poin.fakta_ids) }))
            .filter((poin) => {
              const ok = poin.fakta_ids.length > 0 && poin.text.trim().length > 0;
              if (!ok) dibuang++;
              return ok;
            })
            .map((poin) => ({ id: randomUUID(), text: poin.text.trim(), fakta_ids: poin.fakta_ids })),
        })),
    }))
    .filter((section) => section.entri.length > 0);

  // Section titles follow the language the model actually wrote in, so headings never disagree with the text.
  const contoh = ` ${object.ringkasan} ${bagian.flatMap((b) => b.entri.flatMap((e) => e.poin.map((p) => p.text))).join(" ")} `.toLowerCase();
  const hitung = (kata: string[]) => kata.reduce((n, k) => n + (contoh.split(` ${k} `).length - 1), 0);
  const bahasaTulisan: "id" | "en" = hitung(["dan", "dengan", "yang", "untuk", "di", "dari"]) >= hitung(["and", "with", "the", "for", "in", "of"]) ? "id" : "en";
  // One section per kind, with a fixed title, however the model split them.
  const JUDUL: Record<"id" | "en", Record<BagianCv["jenis"], string>> = {
    id: { pengalaman: "Pengalaman", pendidikan: "Pendidikan", proyek: "Proyek", prestasi: "Prestasi", lainnya: "Lainnya" },
    en: { pengalaman: "Experience", pendidikan: "Education", proyek: "Projects", prestasi: "Awards", lainnya: "Other" },
  };
  const perJenis = new Map<BagianCv["jenis"], BagianCv>();
  for (const section of bagian) {
    const ada = perJenis.get(section.jenis);
    if (ada) ada.entri.push(...section.entri);
    else perJenis.set(section.jenis, { ...section, judul: JUDUL[bahasaTulisan][section.jenis] });
  }
  const bagianRapi = [...perJenis.values()];

  const isi: IsiCv = {
    versi: 2,
    nama: user.name,
    judul: rapikan(object.judul).replace(/^CV\s+/i, ""),
    kontak: { telepon: user.phone ?? undefined, email: user.email ?? undefined, kota: user.district ?? user.city },
    ringkasan: rapikan(object.ringkasan),
    keahlian: object.keahlian
      .map((k) => ({ id: randomUUID(), label: rapikan(k.label), isi: k.isi.map(rapikan).filter(Boolean).slice(0, 10) }))
      .filter((k) => k.label && k.isi.length)
      .slice(0, 4),
    bagian: bagianRapi,
  };
  const faktaDipakai = new Set(bagianRapi.flatMap((section) => section.entri.flatMap((entri) => [...entri.fakta_ids, ...entri.poin.flatMap((poin) => poin.fakta_ids)]))).size;
  return { isi, bahasa, dibuang, faktaDipakai };
}

/**
 * Menyusun CV Khusus dari Fakta terkonfirmasi milik satu Persona (ADR 0003, 0006).
 * Setiap poin wajib menunjuk ke Fakta asal; poin tanpa Fakta yang sah dibuang.
 */
export async function siapkanCvKhusus(
  db: Db,
  models: Models,
  userId: string,
  input: { lowongan_id: string; persona_id: string; template?: "satu_kolom" | "dua_kolom" },
): Promise<HasilSiapkanCv> {
  const sumber = await muatSumber(db, userId, input.persona_id, input.lowongan_id);
  const { isi, bahasa, dibuang, faktaDipakai } = await susunIsi(models, sumber);
  const template = input.template ?? "satu_kolom";
  const [row] = await db
    .insert(cvKhusus)
    .values({ userId, personaId: sumber.persona.id, lowonganId: sumber.target.lowongan.id, template, language: bahasa, isi, isiAwal: isi })
    .returning();
  if (!row) throw new Error("CV Khusus gagal disimpan");
  return {
    id: row.id,
    isi,
    template,
    bahasa,
    fakta_dipakai: faktaDipakai,
    poin_dibuang: dibuang,
    peringatan: template === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
  };
}

/**
 * Merevisi CV Khusus dengan instruksi dari obrolan, misalnya "ringkasan lebih pendek" (ADR 0008).
 * Aturannya sama dengan penyusunan awal: hanya Fakta terkonfirmasi. Versi AI baru menjadi acuan
 * untuk menandai edit manual berikutnya.
 */
export async function revisiCvKhusus(
  db: Db,
  models: Models,
  userId: string,
  input: { cv_id: string; instruksi: string },
): Promise<HasilSiapkanCv> {
  const cv = await db.query.cvKhusus.findFirst({ where: and(eq(cvKhusus.id, input.cv_id), eq(cvKhusus.userId, userId)) });
  if (!cv) throw new HttpError(404, "cv_tidak_ada", "CV tidak ditemukan.");
  if (!cv.personaId || !cv.lowonganId) {
    throw new HttpError(409, "cv_tanpa_sumber", "Lowongan atau kerja untuk CV ini sudah dihapus. Susun CV lamaran baru.");
  }
  const sumber = await muatSumber(db, userId, cv.personaId, cv.lowonganId);
  const { isi, dibuang, faktaDipakai } = await susunIsi(models, sumber, { instruksi: input.instruksi, isi: normalisasiIsi(cv.isi) });
  await db.update(cvKhusus).set({ isi, isiAwal: isi, updatedAt: new Date() }).where(eq(cvKhusus.id, cv.id));
  return {
    id: cv.id,
    isi,
    template: cv.template,
    bahasa: cv.language,
    fakta_dipakai: faktaDipakai,
    poin_dibuang: dibuang,
    peringatan: cv.template === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
  };
}

/**
 * Menyimpan hasil edit manual. Pencari Kerja boleh mengubah apa saja; poin yang
 * tidak lagi sama dengan versi AI ditandai, dan dikembalikan sebagai calon Fakta
 * baru yang bisa ia simpan sendiri.
 */
export async function simpanEditCv(
  db: Db,
  userId: string,
  id: string,
  input: { isi: IsiCv; template?: "satu_kolom" | "dua_kolom" },
) {
  const row = await db.query.cvKhusus.findFirst({ where: and(eq(cvKhusus.id, id), eq(cvKhusus.userId, userId)) });
  if (!row) throw new HttpError(404, "cv_tidak_ada", "CV tidak ditemukan.");
  const awal = teksPerId(normalisasiIsi(row.isiAwal));
  const calonFakta: { item_id: string; text: string }[] = [];
  const isi: IsiCv = {
    ...input.isi,
    versi: 2,
    bagian: input.isi.bagian.map((section) => ({
      ...section,
      entri: section.entri.map((entri) => {
        const teksEntri = [entri.judul, entri.tempat, entri.periode].filter(Boolean).join(" | ");
        const entriBaru = !awal.has(entri.id);
        const entriDiedit = awal.get(entri.id) !== teksEntri;
        // A brand-new entry is a claim Lokerin has no Fakta for yet; offer it as one.
        if (entriBaru && entri.judul.trim()) calonFakta.push({ item_id: entri.id, text: [entri.judul, entri.tempat, entri.periode].filter(Boolean).join(", ") });
        return {
          ...entri,
          fakta_ids: entri.fakta_ids ?? [],
          diedit_pengguna: entriDiedit || undefined,
          poin: entri.poin.map((poin) => {
            const diedit = awal.get(poin.id) !== poin.text;
            if (diedit && (!poin.fakta_ids?.length || !awal.has(poin.id)) && poin.text.trim()) calonFakta.push({ item_id: poin.id, text: poin.text });
            return { ...poin, fakta_ids: poin.fakta_ids ?? [], diedit_pengguna: diedit || undefined };
          }),
        };
      }),
    })),
  };
  const [updated] = await db
    .update(cvKhusus)
    .set({ isi, ...(input.template ? { template: input.template } : {}), updatedAt: new Date() })
    .where(eq(cvKhusus.id, id))
    .returning();
  return {
    id,
    isi: normalisasiIsi(updated?.isi ?? isi),
    template: updated?.template ?? row.template,
    calon_fakta: calonFakta,
    peringatan: (updated?.template ?? row.template) === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
  };
}
