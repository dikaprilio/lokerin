import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { kabar, personas, users, type JenisKabar } from "../db/schema.js";
import { userChannel, type EventBus } from "../events/bus.js";
import { kirimPush, logKabar } from "./push.js";

export type KabarBaru = {
  userId: string;
  jenis: JenisKabar;
  judul: string;
  isi: string;
  tautan: string;
  /** Kabar kecil (misalnya Lamaran Dilihat) hanya tampil di aplikasi. */
  push: boolean;
};

export function kartuKabar(row: typeof kabar.$inferSelect) {
  return {
    id: row.id,
    jenis: row.jenis,
    judul: row.judul,
    isi: row.isi,
    tautan: row.tautan,
    dibaca: row.readAt !== null,
    dibuat_pada: row.createdAt.toISOString(),
  };
}

/**
 * Menyimpan Kabar, memberi tahu layar yang sedang terbuka lewat SSE, lalu mengirim push.
 * Tidak pernah melempar galat ke pemanggil: Kabar yang gagal tidak boleh membatalkan Lamaran.
 */
export async function kirimKabar(db: Db, bus: EventBus, daftar: KabarBaru[]) {
  if (!daftar.length) return;
  try {
    const rows = await db
      .insert(kabar)
      .values(daftar.map(({ push: _push, ...isi }) => isi))
      .returning();
    for (const row of rows) bus.publish([userChannel(row.userId)], { type: "kabar.baru", data: kartuKabar(row) });

    const untukPush = daftar.filter((item) => item.push);
    // Satu push per jenis isi; penerima dengan isi yang sama dikirim bersama.
    const kelompok = new Map<string, { userIds: string[]; item: KabarBaru }>();
    for (const item of untukPush) {
      const kunci = `${item.jenis}|${item.judul}|${item.isi}|${item.tautan}`;
      const ada = kelompok.get(kunci);
      if (ada) ada.userIds.push(item.userId);
      else kelompok.set(kunci, { userIds: [item.userId], item });
    }
    await Promise.all(
      [...kelompok.values()].map(({ userIds, item }) =>
        kirimPush(db, userIds, { judul: item.judul, isi: item.isi, tautan: item.tautan, tag: item.jenis }),
      ),
    );
  } catch (galat) {
    logKabar()?.warn({ err: galat }, "Kabar gagal dikirim");
  }
}

export async function daftarKabar(db: Db, userId: string, batas = 30) {
  const rows = await db
    .select()
    .from(kabar)
    .where(eq(kabar.userId, userId))
    .orderBy(desc(kabar.createdAt))
    .limit(Math.min(Math.max(batas, 1), 100));
  const [belum] = await db
    .select({ n: count() })
    .from(kabar)
    .where(and(eq(kabar.userId, userId), isNull(kabar.readAt)));
  return { kabar: rows.map(kartuKabar), belum_dibaca: Number(belum?.n ?? 0) };
}

/** Tanpa `ids`, semua Kabar pengguna ditandai dibaca. */
export async function tandaiKabarDibaca(db: Db, userId: string, ids?: string[]) {
  await db
    .update(kabar)
    .set({ readAt: new Date() })
    .where(
      and(eq(kabar.userId, userId), isNull(kabar.readAt), ...(ids?.length ? [inArray(kabar.id, ids)] : [])),
    );
  return daftarKabar(db, userId);
}

/** Batas penerima push Butuh Hari Ini, agar satu lowongan tidak menjadi push massal (ADR 0008). */
const PENERIMA_BUTUH_HARI_INI = 50;
/** Jarak kosinus maksimum, sama dengan kemiripan 45% di pencocokan. */
const JARAK_COCOK = 0.55;

/** Pencari Kerja di kota yang sama dengan Persona yang mirip dengan Lowongan mendadak ini. */
export async function penerimaButuhHariIni(db: Db, lowonganId: string, kota: string | null) {
  if (!kota) return [];
  const jarak = sql<number>`${personas.embedding} <=> (select embedding from lowongan where id = ${lowonganId})`;
  const rows = await db
    .select({ userId: users.id, jarak })
    .from(personas)
    .innerJoin(users, eq(users.id, personas.userId))
    .where(
      and(
        eq(users.role, "pencari"),
        isNotNull(personas.embedding),
        sql`lower(${users.city}) = lower(${kota})`,
        sql`(select embedding from lowongan where id = ${lowonganId}) is not null`,
      ),
    )
    .orderBy(jarak)
    .limit(PENERIMA_BUTUH_HARI_INI * 3);
  const unik = new Set<string>();
  for (const row of rows) {
    if (Number(row.jarak) > JARAK_COCOK) break;
    unik.add(row.userId);
    if (unik.size >= PENERIMA_BUTUH_HARI_INI) break;
  }
  return [...unik];
}
