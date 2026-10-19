import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fakta, personas, users, type JenisFakta, type Preferensi } from "../db/schema.js";
import type { Models } from "../ai/models.js";
import { HttpError } from "../auth/session.js";
import { kartuFakta, kartuPersona } from "./serialize.js";

export async function profilInduk(db: Db, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new HttpError(404, "akun_tidak_ada", "Akun tidak ditemukan.");
  const semuaFakta = await db.select().from(fakta).where(eq(fakta.userId, userId)).orderBy(asc(fakta.createdAt));
  const semuaPersona = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(asc(personas.createdAt));
  return {
    pencari: {
      id: user.id,
      nama: user.name,
      kota: user.city,
      kecamatan: user.district,
      pendidikan: user.education,
      tahun_lahir: user.birthYear,
    },
    fakta: semuaFakta.filter((item) => item.status !== "ditolak").map(kartuFakta),
    persona: semuaPersona.map(kartuPersona),
  };
}

export type UsulanFakta = { jenis: JenisFakta; judul: string; detail?: string; tempat?: string; periode?: string; poin?: string[] };

/**
 * The points of an experience (tasks, results) live in `detail`, one per line, after any free note.
 * The CV builder turns each line into a bullet.
 */
export function detailDari(item: { detail?: string | null; poin?: string[] }) {
  const baris = [item.detail ?? "", ...(item.poin ?? [])].flatMap((b) => b.split("\n")).map((b) => b.trim()).filter(Boolean);
  return baris.length ? baris.join("\n") : null;
}

/** AI hanya boleh mengusulkan; Fakta tersimpan setelah Pencari Kerja mengetuk tombol konfirmasi (ADR 0004). */
export async function usulkanFakta(db: Db, userId: string, items: UsulanFakta[], source: "obrolan" | "suara" | "cv") {
  if (!items.length) return [];
  const rows = await db
    .insert(fakta)
    .values(
      items.map((item) => ({
        userId,
        kind: item.jenis,
        title: item.judul,
        detail: detailDari(item),
        place: item.tempat ?? null,
        period: item.periode ?? null,
        status: "usulan" as const,
        source,
      })),
    )
    .returning();
  return rows.map(kartuFakta);
}

export async function putuskanFakta(db: Db, userId: string, ids: string[], terima: boolean) {
  const rows = await db
    .update(fakta)
    .set(terima ? { status: "terkonfirmasi", confirmedAt: new Date() } : { status: "ditolak" })
    .where(and(eq(fakta.userId, userId), inArray(fakta.id, ids), eq(fakta.status, "usulan")))
    .returning();
  return rows.map(kartuFakta);
}

/** Fakta yang diketik sendiri lewat formulir langsung terkonfirmasi. */
export async function tambahFaktaManual(db: Db, userId: string, item: UsulanFakta) {
  const [row] = await db
    .insert(fakta)
    .values({
      userId,
      kind: item.jenis,
      title: item.judul,
      detail: detailDari(item),
      place: item.tempat ?? null,
      period: item.periode ?? null,
      status: "terkonfirmasi",
      source: "formulir",
      confirmedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("Fakta gagal disimpan");
  return kartuFakta(row);
}

export type IsiPersona = {
  judul: string;
  ringkasan?: string;
  keahlian?: string[];
  fakta_ids?: string[];
  preferensi?: Preferensi;
};

export async function simpanPersona(db: Db, models: Models, userId: string, isi: IsiPersona, personaId?: string) {
  if (isi.fakta_ids?.length) {
    const owned = await db
      .select({ id: fakta.id })
      .from(fakta)
      .where(and(eq(fakta.userId, userId), inArray(fakta.id, isi.fakta_ids), eq(fakta.status, "terkonfirmasi")));
    isi.fakta_ids = owned.map((row) => row.id);
  }
  const embedding = await models
    .embed(`${isi.judul}. ${isi.ringkasan ?? ""}. Keahlian: ${(isi.keahlian ?? []).join(", ")}`)
    .catch(() => null);
  const values = {
    title: isi.judul,
    summary: isi.ringkasan ?? "",
    skills: isi.keahlian ?? [],
    faktaIds: isi.fakta_ids ?? [],
    ...(isi.preferensi ? { preferensi: isi.preferensi } : {}),
    embedding,
    updatedAt: new Date(),
  };
  if (personaId) {
    const [row] = await db
      .update(personas)
      .set(values)
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
      .returning();
    if (!row) throw new HttpError(404, "persona_tidak_ada", "Persona tidak ditemukan.");
    return kartuPersona(row);
  }
  const [row] = await db.insert(personas).values({ userId, ...values }).returning();
  if (!row) throw new Error("Persona gagal disimpan");
  return kartuPersona(row);
}

async function milikSendiri(db: Db, userId: string, id: string) {
  const row = await db.query.fakta.findFirst({ where: and(eq(fakta.id, id), eq(fakta.userId, userId), ne(fakta.status, "ditolak")) });
  if (!row) throw new HttpError(404, "fakta_tidak_ada", "Bahan CV tidak ditemukan.");
  return row;
}

/** Hanya pemiliknya yang mengubah Bahan CV, jadi perubahan ini langsung berlaku. */
type IsiUbahFakta = { jenis?: JenisFakta; judul?: string; tempat?: string | null; periode?: string | null; detail?: string | null; poin?: string[] };

export async function ubahFakta(db: Db, userId: string, id: string, isi: IsiUbahFakta) {
  await milikSendiri(db, userId, id);
  const [row] = await db
    .update(fakta)
    .set({
      ...(isi.jenis ? { kind: isi.jenis } : {}),
      ...(isi.judul ? { title: isi.judul } : {}),
      ...(isi.tempat !== undefined ? { place: isi.tempat || null } : {}),
      ...(isi.periode !== undefined ? { period: isi.periode || null } : {}),
      ...(isi.detail !== undefined || isi.poin ? { detail: detailDari({ detail: isi.detail, poin: isi.poin }) } : {}),
    })
    .where(and(eq(fakta.id, id), eq(fakta.userId, userId)))
    .returning();
  if (!row) throw new HttpError(404, "fakta_tidak_ada", "Bahan CV tidak ditemukan.");
  return kartuFakta(row);
}

/** Persona yang menunjuk Fakta lama diarahkan ke penggantinya (atau dilepas bila tidak ada). */
async function alihkanPersona(db: Db, userId: string, lama: string[], baru: string | null) {
  const daftar = await db.select({ id: personas.id, faktaIds: personas.faktaIds }).from(personas).where(eq(personas.userId, userId));
  for (const p of daftar) {
    if (!p.faktaIds.some((id) => lama.includes(id))) continue;
    const ids = [...new Set(p.faktaIds.flatMap((id) => (lama.includes(id) ? (baru ? [baru] : []) : [id])))];
    await db.update(personas).set({ faktaIds: ids }).where(eq(personas.id, p.id));
  }
}

export async function hapusFakta(db: Db, userId: string, id: string) {
  await milikSendiri(db, userId, id);
  await alihkanPersona(db, userId, [id], null);
  await db.delete(fakta).where(and(eq(fakta.id, id), eq(fakta.userId, userId)));
  return { ok: true };
}

/**
 * Menggabungkan beberapa Bahan CV ke satu pengalaman: judul tiap bahan menjadi poin baru di
 * pengalaman itu, lalu bahan asalnya dihapus. Untuk merapikan satu pekerjaan yang terpecah.
 */
export async function gabungFakta(db: Db, userId: string, tujuanId: string, ids: string[]) {
  const tujuan = await milikSendiri(db, userId, tujuanId);
  const asal = (
    await db
      .select()
      .from(fakta)
      .where(and(eq(fakta.userId, userId), inArray(fakta.id, ids), ne(fakta.status, "ditolak")))
  ).filter((row) => row.id !== tujuanId);
  if (!asal.length) return kartuFakta(tujuan);
  const [row] = await db
    .update(fakta)
    .set({ detail: detailDari({ detail: tujuan.detail, poin: asal.map((a) => a.title) }) })
    .where(eq(fakta.id, tujuanId))
    .returning();
  await alihkanPersona(db, userId, asal.map((a) => a.id), tujuanId);
  await db.delete(fakta).where(and(eq(fakta.userId, userId), inArray(fakta.id, asal.map((a) => a.id))));
  if (!row) throw new HttpError(404, "fakta_tidak_ada", "Bahan CV tidak ditemukan.");
  return kartuFakta(row);
}
