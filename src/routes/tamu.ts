import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { users } from "../db/schema.js";
import { periksaAksesGoogle } from "../auth/google.js";
import { issueToken, requireUser, setSessionCookie } from "../auth/session.js";
import { buatTamu, daftarPemberiKerja, ubahPengguna } from "../domain/pengguna.js";
import { parse } from "./util.js";

const teks = (max: number) => z.string().trim().min(1).max(max);

const tamuSchema = z.object({
  peran: z.enum(["pencari", "pemberi"]),
  nama: teks(80),
  kota: teks(80).optional(),
  kecamatan: teks(80).optional(),
});

const googleSchema = z.object({
  access_token: z.string().min(10).max(4096),
  /** Diisi di akhir onboarding untuk membuat akun; tanpa ini, akun baru hanya dikenali. */
  daftar: tamuSchema.optional(),
});

const pemberiKerjaSchema = z.object({
  nama_usaha: teks(120),
  jenis: z.enum(["umkm", "perusahaan", "rumah_tangga"]),
  kota: teks(80),
  kecamatan: teks(80).optional(),
  alamat: teks(240).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  dokumen: z.object({ ktp: z.boolean(), npwp: z.boolean(), foto_usaha: z.boolean() }),
});

const ubahSayaSchema = z
  .object({ nama: teks(80), kota: teks(80), kecamatan: teks(80).nullable() })
  .partial()
  .refine((isi) => Object.keys(isi).length > 0);

/** Akun baru dari onboarding frontend, terpisah dari akun demo satu ketuk. */
export async function tamuRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const secure = ctx.env.NODE_ENV === "production";

  app.post(
    "/auth/tamu",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await buatTamu(db, parse(tamuSchema, request.body));
      const token = issueToken({ id: user.id, role: user.role }, ctx.env.SESSION_SECRET);
      setSessionCookie(reply, token, secure);
      reply.code(201);
      return { token, pengguna: { id: user.id, peran: user.role, nama: user.name, kota: user.city } };
    },
  );

  /**
   * Masuk dengan Google. Akun lama langsung dapat sesi. Akun baru dijawab `baru: true` beserta nama
   * dari Google supaya onboarding bisa mengisinya, lalu dibuat saat onboarding mengirim `daftar`.
   */
  app.post(
    "/auth/google",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = parse(googleSchema, request.body);
      const google = await periksaAksesGoogle(body.access_token, ctx.env.GOOGLE_CLIENT_IDS);
      const cari = () => db.query.users.findFirst({ where: eq(users.googleSub, google.sub) });

      let user = await cari();
      if (!user && !body.daftar) return { baru: true, google: { nama: google.nama, email: google.email } };
      if (!user && body.daftar) {
        try {
          user = await buatTamu(db, body.daftar, { sub: google.sub, email: google.email });
          reply.code(201);
        } catch (galat) {
          // Dua tab menyelesaikan onboarding bersamaan: pakai akun yang sudah jadi.
          const kode = (galat as { code?: string; cause?: { code?: string } }).cause?.code ?? (galat as { code?: string }).code;
          if (kode !== "23505") throw galat;
          user = await cari();
        }
      }
      if (!user) throw new Error("Akun Google gagal dibuat");

      const token = issueToken({ id: user.id, role: user.role }, ctx.env.SESSION_SECRET);
      setSessionCookie(reply, token, secure);
      return { baru: reply.statusCode === 201, token, pengguna: { id: user.id, peran: user.role, nama: user.name, kota: user.city } };
    },
  );

  /** Pemberi Kerja baru mendaftarkan usahanya; satu akun hanya punya satu usaha. */
  app.post("/pemberi/daftar", async (request, reply) => {
    const user = requireUser(request, "pemberi");
    const employer = await daftarPemberiKerja(db, user.id, parse(pemberiKerjaSchema, request.body));
    reply.code(201);
    return employer;
  });

  app.patch("/me", async (request) => {
    const user = requireUser(request);
    return ubahPengguna(db, user.id, parse(ubahSayaSchema, request.body));
  });
}
