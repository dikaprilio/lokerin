import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { issueToken, requireUser, setSessionCookie } from "../auth/session.js";
import { buatTamu, daftarPemberiKerja } from "../domain/pengguna.js";
import { parse } from "./util.js";

const teks = (max: number) => z.string().trim().min(1).max(max);

const tamuSchema = z.object({
  peran: z.enum(["pencari", "pemberi"]),
  nama: teks(80),
  kota: teks(80).optional(),
  kecamatan: teks(80).optional(),
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

  /** Pemberi Kerja baru mendaftarkan usahanya; satu akun hanya punya satu usaha. */
  app.post("/pemberi/daftar", async (request, reply) => {
    const user = requireUser(request, "pemberi");
    const employer = await daftarPemberiKerja(db, user.id, parse(pemberiKerjaSchema, request.body));
    reply.code(201);
    return employer;
  });
}
