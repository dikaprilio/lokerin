import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { employers, lowongan, personas, type Preferensi } from "../db/schema.js";
import type { Models } from "../ai/models.js";
import { formatRupiah, perkiraanBulanan } from "./upah.js";
import { kartuLowongan } from "./serialize.js";

export type CariLowongan = {
  kueri?: string;
  kota?: string[];
  kategori?: string;
  segmen?: "informal" | "magang";
  jenis_upah?: string;
  upah_min_bulanan?: number;
  butuh_hari_ini?: boolean;
  persona_id?: string;
  batas?: number;
};

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/i)
      .filter((word) => word.length > 2),
  );
}

/**
 * Preferensi Wajib disaring lebih dulu di SQL, baru Lowongan diurutkan dengan
 * kemiripan vektor. Lowongan yang melanggar Preferensi Wajib tidak pernah disebut cocok.
 */
export async function cariLowongan(db: Db, models: Models, userId: string | null, input: CariLowongan) {
  let persona: typeof personas.$inferSelect | undefined;
  if (input.persona_id && userId) {
    persona = await db.query.personas.findFirst({
      where: and(eq(personas.id, input.persona_id), eq(personas.userId, userId)),
    });
  }
  const pref: Preferensi = persona?.preferensi ?? { kota: [] };
  const kota = input.kota?.length ? input.kota : pref.mau_pindah ? [] : pref.kota;

  const filters: SQL[] = [eq(lowongan.status, "terbit")];
  if (kota.length) {
    const kotaFilter = or(
      ...kota.flatMap((nama) => [ilike(lowongan.city, `%${nama}%`), ilike(lowongan.district, `%${nama}%`)]),
    );
    if (kotaFilter) filters.push(kotaFilter);
  }
  if (input.kategori) filters.push(eq(lowongan.category, input.kategori));
  if (input.segmen) filters.push(eq(lowongan.segment, input.segmen));
  if (input.jenis_upah) filters.push(eq(lowongan.payType, input.jenis_upah as never));
  if (input.butuh_hari_ini) {
    filters.push(isNotNull(lowongan.urgentUntil), gt(lowongan.urgentUntil, new Date()));
  }

  const queryText = [input.kueri, persona ? `${persona.title}. ${persona.summary}. ${persona.skills.join(", ")}` : ""]
    .filter(Boolean)
    .join("\n");
  // Tanpa embedding (misalnya kunci API bermasalah), pencarian turun ke pencocokan kata dan urutan terbaru.
  const vector = queryText ? await models.embed(queryText).catch(() => null) : null;
  if (!vector && input.kueri) {
    const words = [...tokens(input.kueri)].slice(0, 6);
    const kata = or(...words.flatMap((word) => [ilike(lowongan.title, `%${word}%`), ilike(lowongan.description, `%${word}%`)]));
    if (kata) filters.push(kata);
  }
  const distance = vector
    ? sql<number>`${lowongan.embedding} <=> ${JSON.stringify(vector)}::vector`
    : sql<number>`0`;

  const rows = await db
    .select({ lowongan, employer: employers, distance })
    .from(lowongan)
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(and(...filters))
    .orderBy(vector ? asc(distance) : desc(lowongan.publishedAt))
    .limit(Math.min(input.batas ?? 8, 20) * 2);

  const upahMin =
    input.upah_min_bulanan ??
    (pref.upah_min ? (pref.upah_satuan === "harian" ? Math.round(pref.upah_min * 6 * 4.33) : pref.upah_min) : undefined);

  const hasil = [];
  const diLuarPreferensi = [];
  for (const row of rows) {
    const bulanan = perkiraanBulanan(row.lowongan);
    const alasan: string[] = [];
    if (row.lowongan.city) alasan.push(`Lokasi: ${row.lowongan.district ?? row.lowongan.city}`);
    if (row.employer.status === "terverifikasi") alasan.push("Pemberi Kerja Terverifikasi");
    if (persona) {
      const keahlian = tokens(persona.skills.join(" ") + " " + persona.title);
      const lowonganWords = tokens(
        `${row.lowongan.title} ${row.lowongan.description} ${row.lowongan.requirements.join(" ")}`,
      );
      const sama = [...keahlian].filter((word) => lowonganWords.has(word));
      if (sama.length) alasan.push(`Cocok dengan keahlian ${persona.title}: ${sama.slice(0, 3).join(", ")}`);
    }
    if (bulanan && upahMin) {
      if (bulanan < upahMin) {
        diLuarPreferensi.push(
          kartuLowongan(row.lowongan, row.employer, {
            alasan_di_luar: `Upah sekitar ${formatRupiah(bulanan)}/bulan, di bawah minimal ${formatRupiah(upahMin)}`,
          }),
        );
        continue;
      }
      alasan.push(`Upah sekitar ${formatRupiah(bulanan)}/bulan, sesuai minimal kamu`);
    }
    hasil.push(
      kartuLowongan(row.lowongan, row.employer, {
        kemiripan: vector ? Math.max(0, Math.round((1 - Number(row.distance)) * 100)) : null,
        kenapa_cocok: alasan,
      }),
    );
  }

  return {
    persona: persona ? { id: persona.id, judul: persona.title } : null,
    filter: { kota, kategori: input.kategori ?? null, segmen: input.segmen ?? null, upah_min_bulanan: upahMin ?? null },
    hasil: hasil.slice(0, input.batas ?? 8),
    di_luar_preferensi: diLuarPreferensi.slice(0, 3),
  };
}

export async function lowonganDiSekitar(db: Db, lat: number, lng: number, radiusKm: number) {
  const distanceKm = sql<number>`6371 * acos(least(1, greatest(-1,
    cos(radians(${lat})) * cos(radians(${lowongan.lat})) * cos(radians(${lowongan.lng}) - radians(${lng}))
    + sin(radians(${lat})) * sin(radians(${lowongan.lat})))))`;
  const rows = await db
    .select({ lowongan, employer: employers, distanceKm })
    .from(lowongan)
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(and(eq(lowongan.status, "terbit"), isNotNull(lowongan.lat), sql`${distanceKm} <= ${radiusKm}`))
    .orderBy(asc(distanceKm))
    .limit(100);
  return rows.map((row) =>
    kartuLowongan(row.lowongan, row.employer, { jarak_km: Math.round(Number(row.distanceKm) * 10) / 10 }),
  );
}

export async function embedLowongan(db: Db, models: Models, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select().from(lowongan).where(inArray(lowongan.id, ids));
  const texts = rows.map((row) =>
    [row.title, row.category, row.description, row.requirements.join(", "), row.district, row.city]
      .filter(Boolean)
      .join("\n"),
  );
  const vectors = await models.embedMany(texts).catch((error: unknown) => {
    console.warn("Embedding Lowongan gagal; jalankan `pnpm db:embed` setelah kunci API diperbaiki.", String(error).slice(0, 120));
    return [] as number[][];
  });
  await Promise.all(
    rows.map((row, index) => {
      const embedding = vectors[index];
      return embedding ? db.update(lowongan).set({ embedding }).where(eq(lowongan.id, row.id)) : undefined;
    }),
  );
}
