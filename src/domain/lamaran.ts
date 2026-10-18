import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  cvKhusus,
  employers,
  lamaran,
  lowongan,
  personas,
  tahapBerikutnya,
  users,
  type StatusLamaran,
} from "../db/schema.js";
import { HttpError } from "../auth/session.js";
import { userChannel, type EventBus } from "../events/bus.js";
import { kartuLamaran } from "./serialize.js";
import { employerOf } from "./lowongan.js";

export type TahapInput = {
  jenis: "whatsapp" | "meet" | "alamat" | "lainnya";
  detail: string;
  jadwal?: string | null;
  catatan?: string | null;
};

async function cards(db: Db, rows: (typeof lamaran.$inferSelect)[], untuk: "pencari" | "pemberi") {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const joined = await db
    .select({ lamaran, pencari: users, persona: personas, lowongan, employer: employers })
    .from(lamaran)
    .innerJoin(users, eq(users.id, lamaran.pencariId))
    .innerJoin(personas, eq(personas.id, lamaran.personaId))
    .innerJoin(lowongan, eq(lowongan.id, lamaran.lowonganId))
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(inArray(lamaran.id, ids))
    .orderBy(desc(lamaran.createdAt));
  const tahap = await db.select().from(tahapBerikutnya).where(inArray(tahapBerikutnya.lamaranId, ids));
  return joined.map((row) =>
    kartuLamaran(row.lamaran, {
      pencari: row.pencari,
      persona: row.persona,
      lowongan: row.lowongan,
      employer: row.employer,
      tahap: tahap.filter((item) => item.lamaranId === row.lamaran.id),
      untuk,
    }),
  );
}

export async function lamaranPencari(db: Db, userId: string) {
  const rows = await db.select().from(lamaran).where(eq(lamaran.pencariId, userId));
  return cards(db, rows, "pencari");
}

export async function lamaranMasuk(db: Db, userId: string, lowonganId?: string) {
  const employer = await employerOf(db, userId);
  const rows = await db
    .select({ lamaran })
    .from(lamaran)
    .innerJoin(lowongan, eq(lowongan.id, lamaran.lowonganId))
    .where(
      and(eq(lowongan.employerId, employer.id), ...(lowonganId ? [eq(lamaran.lowonganId, lowonganId)] : [])),
    );
  return cards(
    db,
    rows.map((row) => row.lamaran),
    "pemberi",
  );
}

/** Aksi final: hanya dipanggil dari tombol yang diketuk Pencari Kerja (ADR 0004). */
export async function kirimLamaran(
  db: Db,
  bus: EventBus,
  userId: string,
  input: { lowongan_id: string; persona_id: string; cv_khusus_id?: string | null; pesan?: string | null },
) {
  const target = await db
    .select({ lowongan, employer: employers })
    .from(lowongan)
    .innerJoin(employers, eq(employers.id, lowongan.employerId))
    .where(eq(lowongan.id, input.lowongan_id))
    .then((rows) => rows[0]);
  if (!target || target.lowongan.status !== "terbit") {
    throw new HttpError(404, "lowongan_tidak_ada", "Lowongan ini tidak ditemukan atau sudah ditutup.");
  }
  const persona = await db.query.personas.findFirst({
    where: and(eq(personas.id, input.persona_id), eq(personas.userId, userId)),
  });
  if (!persona) throw new HttpError(400, "persona_tidak_ada", "Pilih salah satu Persona kamu untuk melamar.");
  if (input.cv_khusus_id) {
    const cv = await db.query.cvKhusus.findFirst({
      where: and(eq(cvKhusus.id, input.cv_khusus_id), eq(cvKhusus.userId, userId)),
    });
    if (!cv) throw new HttpError(400, "cv_tidak_ada", "CV Khusus tidak ditemukan.");
  }
  const existing = await db.query.lamaran.findFirst({
    where: and(eq(lamaran.lowonganId, input.lowongan_id), eq(lamaran.pencariId, userId)),
  });
  if (existing) throw new HttpError(409, "sudah_melamar", "Kamu sudah mengirim Lamaran untuk Lowongan ini.");

  const [row] = await db
    .insert(lamaran)
    .values({
      lowonganId: input.lowongan_id,
      pencariId: userId,
      personaId: persona.id,
      cvKhususId: input.cv_khusus_id ?? null,
      pesan: input.pesan ?? null,
    })
    .returning();
  if (!row) throw new Error("Lamaran gagal dikirim");
  const [forEmployer] = await cards(db, [row], "pemberi");
  const [forPencari] = await cards(db, [row], "pencari");
  bus.publish([userChannel(target.employer.userId)], { type: "lamaran.masuk", data: forEmployer });
  return forPencari;
}

async function lamaranMilikPemberi(db: Db, userId: string, id: string) {
  const employer = await employerOf(db, userId);
  const row = await db
    .select({ lamaran })
    .from(lamaran)
    .innerJoin(lowongan, eq(lowongan.id, lamaran.lowonganId))
    .where(and(eq(lamaran.id, id), eq(lowongan.employerId, employer.id)))
    .then((rows) => rows[0]?.lamaran);
  if (!row) throw new HttpError(404, "lamaran_tidak_ada", "Lamaran tidak ditemukan.");
  return row;
}

async function ubahStatus(db: Db, bus: EventBus, row: typeof lamaran.$inferSelect, status: StatusLamaran) {
  const now = new Date();
  const [updated] = await db
    .update(lamaran)
    .set({
      status,
      ...(status === "dilihat" ? { seenAt: row.seenAt ?? now } : { decidedAt: now, seenAt: row.seenAt ?? now }),
    })
    .where(eq(lamaran.id, row.id))
    .returning();
  if (!updated) throw new Error("Status Lamaran gagal diubah");
  const [forPencari] = await cards(db, [updated], "pencari");
  bus.publish([userChannel(updated.pencariId)], { type: "lamaran.status", data: forPencari });
  const [forEmployer] = await cards(db, [updated], "pemberi");
  return forEmployer;
}

export async function tandaiDilihat(db: Db, bus: EventBus, userId: string, id: string) {
  const row = await lamaranMilikPemberi(db, userId, id);
  if (row.status !== "terkirim") return (await cards(db, [row], "pemberi"))[0];
  return ubahStatus(db, bus, row, "dilihat");
}

async function simpanTahap(db: Db, lamaranId: string, tahap: TahapInput) {
  if (!tahap.detail?.trim()) throw new HttpError(400, "tahap_kosong", "Tulis Tahap Berikutnya, misalnya nomor WhatsApp, tautan Meet, atau alamat.");
  await db.insert(tahapBerikutnya).values({
    lamaranId,
    kind: tahap.jenis,
    detail: tahap.detail.trim(),
    scheduledAt: tahap.jadwal ? new Date(tahap.jadwal) : null,
    note: tahap.catatan ?? null,
  });
}

/** Aksi final: Lolos selalu disertai Tahap Berikutnya yang ditulis Pemberi Kerja. */
export async function tandaiLolos(db: Db, bus: EventBus, userId: string, id: string, tahap: TahapInput) {
  const row = await lamaranMilikPemberi(db, userId, id);
  if (row.status === "lolos") throw new HttpError(409, "sudah_lolos", "Lamaran ini sudah Lolos. Tambahkan tahap baru bila perlu.");
  await simpanTahap(db, row.id, tahap);
  return ubahStatus(db, bus, row, "lolos");
}

export async function tandaiTidakLolos(db: Db, bus: EventBus, userId: string, id: string) {
  const row = await lamaranMilikPemberi(db, userId, id);
  return ubahStatus(db, bus, row, "tidak_lolos");
}

export async function tambahTahap(db: Db, bus: EventBus, userId: string, id: string, tahap: TahapInput) {
  const row = await lamaranMilikPemberi(db, userId, id);
  if (row.status !== "lolos") throw new HttpError(409, "belum_lolos", "Tahap Berikutnya hanya untuk Lamaran yang Lolos.");
  await simpanTahap(db, row.id, tahap);
  const [forPencari] = await cards(db, [row], "pencari");
  bus.publish([userChannel(row.pencariId)], { type: "lamaran.status", data: forPencari });
  return (await cards(db, [row], "pemberi"))[0];
}

export async function lamaranUntuk(db: Db, userId: string, role: "pencari" | "pemberi", id: string) {
  if (role === "pemberi") {
    const row = await lamaranMilikPemberi(db, userId, id);
    return (await cards(db, [row], "pemberi"))[0];
  }
  const row = await db.query.lamaran.findFirst({ where: and(eq(lamaran.id, id), eq(lamaran.pencariId, userId)) });
  if (!row) throw new HttpError(404, "lamaran_tidak_ada", "Lamaran tidak ditemukan.");
  return (await cards(db, [row], "pencari"))[0];
}
