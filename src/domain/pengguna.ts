import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { employers, users, type CekVerifikasi, type Peran } from "../db/schema.js";
import { HttpError } from "../auth/session.js";
import { kartuPemberiKerja } from "./serialize.js";

export const KOTA_AWAL = "Purwokerto";

export type IsiTamu = { peran: Peran; nama: string; kota?: string; kecamatan?: string };

/** Akun tamu dari onboarding: akun sungguhan tanpa `demoKey`, jadi akun demo hasil seed tidak tertimpa. */
export async function buatTamu(db: Db, isi: IsiTamu) {
  const [user] = await db
    .insert(users)
    .values({ role: isi.peran, name: isi.nama, city: isi.kota ?? KOTA_AWAL, district: isi.kecamatan ?? null })
    .returning();
  if (!user) throw new Error("Akun tamu gagal dibuat");
  return user;
}

export type IsiPemberiKerja = {
  nama_usaha: string;
  jenis: "umkm" | "perusahaan" | "rumah_tangga";
  kota: string;
  kecamatan?: string;
  alamat?: string;
  lat?: number;
  lng?: number;
  dokumen: CekVerifikasi;
};

/**
 * Verifikasi masih demo: dokumen hanya dicentang, belum diunggah. Dengan KTP, status menjadi
 * `menunggu` peninjauan; lencana Terverifikasi tidak pernah diberikan otomatis.
 */
export async function daftarPemberiKerja(db: Db, userId: string, isi: IsiPemberiKerja) {
  const [employer] = await db
    .insert(employers)
    .values({
      userId,
      businessName: isi.nama_usaha,
      kind: isi.jenis,
      city: isi.kota,
      district: isi.kecamatan ?? null,
      address: isi.alamat ?? null,
      lat: isi.lat ?? null,
      lng: isi.lng ?? null,
      checks: isi.dokumen,
      status: isi.dokumen.ktp ? "menunggu" : "belum",
    })
    .onConflictDoNothing({ target: employers.userId })
    .returning();
  if (!employer) throw new HttpError(409, "sudah_terdaftar", "Akun ini sudah terdaftar sebagai Pemberi Kerja.");
  return kartuPemberiKerja(employer);
}

/** Bentuk respons `GET /me` dan `PATCH /me`. */
export async function dataSaya(db: Db, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new HttpError(401, "belum_masuk", "Akun tidak ditemukan; masuk ulang.");
  const employer =
    user.role === "pemberi" ? await db.query.employers.findFirst({ where: eq(employers.userId, user.id) }) : null;
  return {
    id: user.id,
    peran: user.role,
    nama: user.name,
    kota: user.city,
    kecamatan: user.district,
    pemberi_kerja: employer ? kartuPemberiKerja(employer) : null,
  };
}

export type UbahPengguna = { nama?: string; kota?: string; kecamatan?: string | null };

/** Nama dan lokasi bisa diubah setelah onboarding; `kecamatan: null` mengosongkannya. */
export async function ubahPengguna(db: Db, userId: string, isi: UbahPengguna) {
  const values: Partial<typeof users.$inferInsert> = {};
  if (isi.nama !== undefined) values.name = isi.nama;
  if (isi.kota !== undefined) values.city = isi.kota;
  if (isi.kecamatan !== undefined) values.district = isi.kecamatan;
  const [row] = await db.update(users).set(values).where(eq(users.id, userId)).returning({ id: users.id });
  if (!row) throw new HttpError(401, "belum_masuk", "Akun tidak ditemukan; masuk ulang.");
  return dataSaya(db, userId);
}
