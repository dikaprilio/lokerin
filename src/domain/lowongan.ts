import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { employers, lowongan, type JenisUpah } from "../db/schema.js";
import { HttpError } from "../auth/session.js";
import { batasButuhHariIni } from "./jadwal.js";
import { periksaDraf } from "./pemeriksaan.js";
import { kartuLowongan } from "./serialize.js";

export type IsiDraf = {
  title?: string | null;
  category?: string | null;
  segment?: "informal" | "magang";
  description?: string | null;
  requirements?: string[] | null;
  payType?: JenisUpah | null;
  payMin?: number | null;
  payMax?: number | null;
  hoursPerDay?: number | null;
  daysPerWeek?: number | null;
  hoursText?: string | null;
  employmentType?: string | null;
  startDate?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  urgentHours?: number | null;
  language?: "id" | "en";
};

export async function employerOf(db: Db, userId: string) {
  const employer = await db.query.employers.findFirst({ where: eq(employers.userId, userId) });
  if (!employer) throw new HttpError(403, "bukan_pemberi_kerja", "Akun ini belum terdaftar sebagai Pemberi Kerja.");
  return employer;
}

function toColumns(isi: IsiDraf) {
  const columns: Partial<typeof lowongan.$inferInsert> = {};
  const assign = <K extends keyof typeof lowongan.$inferInsert>(key: K, value: (typeof lowongan.$inferInsert)[K] | undefined) => {
    if (value !== undefined) columns[key] = value;
  };
  assign("title", isi.title ?? undefined);
  assign("category", isi.category ?? undefined);
  assign("segment", isi.segment);
  assign("description", isi.description ?? undefined);
  assign("requirements", isi.requirements ?? undefined);
  assign("payType", isi.payType);
  assign("payMin", isi.payMin);
  assign("payMax", isi.payMax);
  assign("hoursPerDay", isi.hoursPerDay);
  assign("daysPerWeek", isi.daysPerWeek);
  assign("hoursText", isi.hoursText);
  assign("employmentType", isi.employmentType);
  assign("startDate", isi.startDate);
  assign("city", isi.city);
  assign("district", isi.district);
  assign("address", isi.address);
  assign("lat", isi.lat);
  assign("lng", isi.lng);
  assign("language", isi.language);
  if (isi.urgentHours !== undefined) {
    columns.urgentUntil = isi.urgentHours ? new Date(Date.now() + isi.urgentHours * 3600_000) : null;
  }
  return columns;
}

/**
 * Butuh Hari Ini tanpa kata "mendadak": draf yang mulai hari ini ditandai sampai jam kerjanya
 * (batasButuhHariIni). Batas yang disebut sendiri (urgentHours, juga dari formulir) selalu menang, dan
 * tanda yang masih berlaku tidak diubah. Undefined berarti kolomnya tidak disentuh.
 */
function butuhHariIniDariMulai(isi: IsiDraf, sebelumnya?: typeof lowongan.$inferSelect) {
  if (isi.urgentHours !== undefined || !isi.startDate) return undefined;
  const sekarang = new Date();
  if (sebelumnya?.urgentUntil && sebelumnya.urgentUntil > sekarang) return undefined;
  return batasButuhHariIni(isi.startDate, isi.hoursText ?? sebelumnya?.hoursText, sekarang) ?? undefined;
}

function periksa(row: typeof lowongan.$inferSelect) {
  return periksaDraf({
    title: row.title,
    description: row.description,
    requirements: row.requirements,
    payType: row.payType,
    payMin: row.payMin,
    payMax: row.payMax,
    hoursPerDay: row.hoursPerDay,
    daysPerWeek: row.daysPerWeek,
    hoursText: row.hoursText,
    employmentType: row.employmentType,
    startDate: row.startDate,
    city: row.city,
    address: row.address,
    segment: row.segment,
  });
}

export async function buatDraf(db: Db, userId: string, isi: IsiDraf) {
  const employer = await employerOf(db, userId);
  const butuhHariIni = butuhHariIniDariMulai(isi);
  const [created] = await db
    .insert(lowongan)
    .values({
      employerId: employer.id,
      title: isi.title ?? "",
      category: isi.category ?? "lainnya",
      city: isi.city ?? employer.city,
      district: isi.district ?? employer.district,
      address: isi.address ?? employer.address,
      lat: isi.lat ?? employer.lat,
      lng: isi.lng ?? employer.lng,
      ...toColumns({ ...isi, city: isi.city ?? employer.city }),
      ...(butuhHariIni ? { urgentUntil: butuhHariIni } : {}),
      status: "draf",
    })
    .returning();
  if (!created) throw new Error("Draf gagal dibuat");
  const hasil = periksa(created);
  const [checked] = await db.update(lowongan).set({ pemeriksaan: hasil }).where(eq(lowongan.id, created.id)).returning();
  return kartuLowongan(checked ?? created, employer);
}

export async function ubahDraf(db: Db, userId: string, id: string, isi: IsiDraf) {
  const employer = await employerOf(db, userId);
  const current = await db.query.lowongan.findFirst({
    where: and(eq(lowongan.id, id), eq(lowongan.employerId, employer.id)),
  });
  if (!current) throw new HttpError(404, "lowongan_tidak_ada", "Lowongan tidak ditemukan.");
  if (current.status !== "draf") {
    throw new HttpError(409, "sudah_terbit", "Lowongan yang sudah Terbit tidak bisa diubah lewat draf.");
  }
  const butuhHariIni = butuhHariIniDariMulai(isi, current);
  const [updated] = await db
    .update(lowongan)
    .set({ ...toColumns(isi), ...(butuhHariIni ? { urgentUntil: butuhHariIni } : {}), updatedAt: new Date() })
    .where(eq(lowongan.id, id))
    .returning();
  if (!updated) throw new Error("Draf gagal diubah");
  const hasil = periksa(updated);
  const [checked] = await db.update(lowongan).set({ pemeriksaan: hasil }).where(eq(lowongan.id, id)).returning();
  return kartuLowongan(checked ?? updated, employer);
}

export async function periksaUlang(db: Db, userId: string, id: string) {
  return ubahDraf(db, userId, id, {});
}
