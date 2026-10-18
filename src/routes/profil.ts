import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { personas, users } from "../db/schema.js";
import { HttpError, requireUser } from "../auth/session.js";
import { profilInduk, putuskanFakta, simpanPersona, tambahFaktaManual } from "../domain/profil.js";
import { idParam, parse } from "./util.js";

const faktaSchema = z.object({
  jenis: z.enum(["pengalaman", "keahlian", "pendidikan", "prestasi", "lainnya"]),
  judul: z.string().min(1).max(200),
  detail: z.string().max(1000).optional(),
  tempat: z.string().max(200).optional(),
  periode: z.string().max(80).optional(),
});

const personaSchema = z.object({
  judul: z.string().min(1).max(80),
  ringkasan: z.string().max(600).optional(),
  keahlian: z.array(z.string().max(60)).max(20).optional(),
  fakta_ids: z.array(z.string().uuid()).max(40).optional(),
  preferensi: z
    .object({
      kota: z.array(z.string()).max(10),
      upah_min: z.number().int().nonnegative().optional(),
      upah_satuan: z.enum(["harian", "bulanan"]).optional(),
      mulai: z.string().optional(),
      jenis_kerja: z.array(z.string()).optional(),
      mau_pindah: z.boolean().optional(),
    })
    .optional(),
});

export async function profilRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get("/profil", async (request) => profilInduk(db, requireUser(request, "pencari").id));

  /** Fakta yang diketik sendiri langsung terkonfirmasi. */
  app.post("/fakta", async (request) => {
    const user = requireUser(request, "pencari");
    return tambahFaktaManual(db, user.id, parse(faktaSchema, request.body));
  });

  /** Aksi final: menyimpan atau menolak Fakta usulan AI lewat tombol (ADR 0004). */
  app.post("/fakta/putuskan", async (request) => {
    const user = requireUser(request, "pencari");
    const body = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(20), terima: z.boolean() }), request.body);
    return { fakta: await putuskanFakta(db, user.id, body.ids, body.terima) };
  });

  app.post("/persona", async (request) => {
    const user = requireUser(request, "pencari");
    return simpanPersona(db, ctx.models, user.id, parse(personaSchema, request.body));
  });

  app.patch("/persona/:id", async (request) => {
    const user = requireUser(request, "pencari");
    const { id } = parse(idParam, request.params);
    return simpanPersona(db, ctx.models, user.id, parse(personaSchema, request.body), id);
  });

  /**
   * Kartu Kerja: ringkasan satu Persona untuk dibagikan lewat kode QR.
   * Publik, tanpa kontak; pemberi kerja menghubungi lewat Lokerin.
   */
  app.get("/kartu-kerja/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    const row = await db
      .select({ persona: personas, user: users })
      .from(personas)
      .innerJoin(users, eq(users.id, personas.userId))
      .where(eq(personas.id, id))
      .then((rows) => rows[0]);
    if (!row) throw new HttpError(404, "kartu_tidak_ada", "Kartu Kerja tidak ditemukan.");
    return {
      id: row.persona.id,
      nama: row.user.name,
      kota: row.user.district ?? row.user.city,
      judul: row.persona.title,
      ringkasan: row.persona.summary,
      keahlian: row.persona.skills,
      tautan: `${ctx.env.PUBLIC_WEB_URL}/kartu/${row.persona.id}`,
    };
  });
}
