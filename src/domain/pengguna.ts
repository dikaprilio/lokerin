import type { Db } from "../db/client.js";
import { users, type Peran } from "../db/schema.js";

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
