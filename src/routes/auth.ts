import type { FastifyInstance } from "fastify";
import { asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { employers, users } from "../db/schema.js";
import { HttpError, SESSION_COOKIE, issueToken, requireUser, setSessionCookie } from "../auth/session.js";
import { kartuPemberiKerja } from "../domain/serialize.js";
import { parse } from "./util.js";

const DEMO_UTAMA = ["pak-darto", "raka", "bu-wati", "belum-verif"];

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const secure = ctx.env.NODE_ENV === "production";

  /** Akun demo satu ketuk untuk juri; login asli menyusul sebelum final. */
  app.get("/auth/akun-demo", async () => {
    const rows = await ctx.db
      .select({ user: users, employer: employers })
      .from(users)
      .leftJoin(employers, eq(employers.userId, users.id))
      .where(isNotNull(users.demoKey))
      .orderBy(asc(users.createdAt));
    const akun = rows.map((row) => ({
      key: row.user.demoKey,
      peran: row.user.role,
      nama: row.user.name,
      kota: row.user.district ?? row.user.city,
      pemberi_kerja: row.employer ? kartuPemberiKerja(row.employer) : null,
    }));
    return {
      utama: DEMO_UTAMA.map((key) => akun.find((item) => item.key === key)).filter(Boolean),
      lainnya: akun.filter((item) => !DEMO_UTAMA.includes(item.key ?? "")),
    };
  });

  app.post("/auth/demo", async (request, reply) => {
    const { key } = parse(z.object({ key: z.string().min(1) }), request.body);
    const user = await ctx.db.query.users.findFirst({ where: eq(users.demoKey, key) });
    if (!user) throw new HttpError(404, "akun_tidak_ada", "Akun demo tidak ditemukan.");
    const token = issueToken({ id: user.id, role: user.role }, ctx.env.SESSION_SECRET);
    setSessionCookie(reply, token, secure);
    return { token, pengguna: { id: user.id, peran: user.role, nama: user.name, kota: user.city } };
  });

  app.post("/auth/keluar", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (request) => {
    const session = requireUser(request);
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, session.id) });
    if (!user) throw new HttpError(401, "belum_masuk", "Akun tidak ditemukan; masuk ulang.");
    const employer =
      user.role === "pemberi" ? await ctx.db.query.employers.findFirst({ where: eq(employers.userId, user.id) }) : null;
    return {
      id: user.id,
      peran: user.role,
      nama: user.name,
      kota: user.city,
      kecamatan: user.district,
      pemberi_kerja: employer ? kartuPemberiKerja(employer) : null,
    };
  });
}
