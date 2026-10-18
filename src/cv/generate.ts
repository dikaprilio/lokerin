import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { cvKhusus, employers, fakta, lowongan, personas, users, type IsiCv } from "../db/schema.js";
import type { Models } from "../ai/models.js";
import { HttpError } from "../auth/session.js";

const draftSchema = z.object({
  judul: z.string().describe("Judul profesional singkat yang sesuai Lowongan, misalnya 'Juru Masak' atau 'UI/UX Designer'"),
  ringkasan: z.string().describe("2-3 kalimat, hanya dari Fakta yang diberikan"),
  keahlian: z.array(z.string()).describe("Keahlian yang relevan dengan Lowongan, diambil dari Fakta"),
  bagian: z.array(
    z.object({
      judul: z.string().describe("Nama bagian, misalnya Pengalaman, Proyek, Pendidikan, Prestasi"),
      items: z.array(
        z.object({
          text: z.string().describe("Satu poin CV yang diringkas atau diurutkan ulang dari Fakta"),
          fakta_ids: z.array(z.string()).describe("ID Fakta asal poin ini; wajib minimal satu"),
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
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const persona = await db.query.personas.findFirst({
    where: and(eq(personas.id, input.persona_id), eq(personas.userId, userId)),
  });
  const target = await db
    .select({ lowongan, employer: employers })
    .from(lowongan)
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(eq(lowongan.id, input.lowongan_id))
    .then((rows) => rows[0]);
  if (!user || !persona) throw new HttpError(404, "persona_tidak_ada", "Persona tidak ditemukan.");
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
      "Belum ada Fakta terkonfirmasi untuk Persona ini. Ceritakan pengalamanmu dulu, lalu konfirmasi Faktanya.",
    );
  }

  const bahasa = target.lowongan.language;
  const daftarFakta = sumber
    .map((item) => `- [${item.id}] (${item.kind}) ${item.title}${item.place ? ` di ${item.place}` : ""}${item.period ? `, ${item.period}` : ""}${item.detail ? `: ${item.detail}` : ""}`)
    .join("\n");

  const { object } = await generateObject({
    model: models.chat("none"),
    schema: draftSchema,
    system: [
      "Kamu menyusun CV Khusus untuk satu Lamaran di Lokerin.",
      "ATURAN MUTLAK: hanya gunakan Fakta di daftar. Boleh meringkas, mengurutkan ulang, dan merapikan bahasa, tetapi DILARANG menambah pengalaman, angka, nama tempat, atau keahlian yang tidak ada di Fakta.",
      "Setiap poin wajib mencantumkan fakta_ids yang menjadi sumbernya.",
      "Utamakan Fakta yang paling relevan dengan Lowongan; Fakta yang tidak relevan boleh diringkas atau tidak dipakai.",
      bahasa === "en" ? "Tulis CV dalam bahasa Inggris." : "Tulis CV dalam Bahasa Indonesia yang baku tetapi sederhana.",
    ].join("\n"),
    prompt: [
      `Lowongan: ${target.lowongan.title} di ${target.employer.businessName} (${target.lowongan.city ?? ""})`,
      `Deskripsi: ${target.lowongan.description}`,
      `Syarat: ${target.lowongan.requirements.join("; ")}`,
      `Persona: ${persona.title}. ${persona.summary}`,
      "Fakta:",
      daftarFakta,
    ].join("\n"),
  });

  const sah = new Set(sumber.map((item) => item.id));
  let dibuang = 0;
  const bagian = object.bagian
    .map((section) => ({
      id: randomUUID(),
      judul: section.judul,
      items: section.items
        .map((item) => ({ ...item, fakta_ids: item.fakta_ids.filter((faktaId) => sah.has(faktaId)) }))
        .filter((item) => {
          const ok = item.fakta_ids.length > 0 && item.text.trim().length > 0;
          if (!ok) dibuang++;
          return ok;
        })
        .map((item) => ({ id: randomUUID(), text: item.text.trim(), fakta_ids: item.fakta_ids })),
    }))
    .filter((section) => section.items.length > 0);

  const isi: IsiCv = {
    nama: user.name,
    judul: object.judul,
    kontak: { telepon: user.phone ?? undefined, email: user.email ?? undefined, kota: user.city },
    ringkasan: object.ringkasan,
    keahlian: object.keahlian.slice(0, 12),
    bagian,
  };

  const template = input.template ?? "satu_kolom";
  const [row] = await db
    .insert(cvKhusus)
    .values({ userId, personaId: persona.id, lowonganId: target.lowongan.id, template, language: bahasa, isi, isiAwal: isi })
    .returning();
  if (!row) throw new Error("CV Khusus gagal disimpan");
  return {
    id: row.id,
    isi,
    template,
    bahasa,
    fakta_dipakai: new Set(bagian.flatMap((section) => section.items.flatMap((item) => item.fakta_ids))).size,
    poin_dibuang: dibuang,
    peringatan: template === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
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
  if (!row) throw new HttpError(404, "cv_tidak_ada", "CV Khusus tidak ditemukan.");
  const awal = new Map(row.isiAwal.bagian.flatMap((section) => section.items.map((item) => [item.id, item.text])));
  const calonFakta: { item_id: string; text: string }[] = [];
  const isi: IsiCv = {
    ...input.isi,
    bagian: input.isi.bagian.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const edited = awal.get(item.id) !== item.text;
        if (edited && (!item.fakta_ids?.length || !awal.has(item.id))) calonFakta.push({ item_id: item.id, text: item.text });
        return { ...item, fakta_ids: item.fakta_ids ?? [], diedit_pengguna: edited || undefined };
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
    isi: updated?.isi ?? isi,
    template: updated?.template ?? row.template,
    calon_fakta: calonFakta,
    peringatan: (updated?.template ?? row.template) === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
  };
}
