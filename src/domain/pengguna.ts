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
