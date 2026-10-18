import { and, asc, eq, inArray } from "drizzle-orm";
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

export type UsulanFakta = { jenis: JenisFakta; judul: string; detail?: string; tempat?: string; periode?: string };

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
        detail: item.detail ?? null,
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
      detail: item.detail ?? null,
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
  const embedding = await models.embed(
    `${isi.judul}. ${isi.ringkasan ?? ""}. Keahlian: ${(isi.keahlian ?? []).join(", ")}`,
  );
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
