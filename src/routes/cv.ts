import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { cvKhusus, employers, lamaran, lowongan, type IsiCv } from "../db/schema.js";
import { HttpError, requireUser, type SessionUser } from "../auth/session.js";
import { siapkanCvKhusus, simpanEditCv } from "../cv/generate.js";
import { renderCvHtml } from "../cv/template.js";
import { htmlToPdf } from "../cv/pdf.js";
import { idParam, parse } from "./util.js";

const isiSchema: z.ZodType<IsiCv> = z.object({
  nama: z.string().max(120),
  judul: z.string().max(160),
  kontak: z.object({ telepon: z.string().max(40).optional(), email: z.string().max(120).optional(), kota: z.string().max(80).optional() }),
  ringkasan: z.string().max(2000),
  keahlian: z.array(z.string().max(80)).max(30),
  bagian: z
    .array(
      z.object({
        id: z.string().max(64),
        judul: z.string().max(80),
        items: z
          .array(
            z.object({
              id: z.string().max(64),
              text: z.string().max(600),
              fakta_ids: z.array(z.string()).max(10),
              diedit_pengguna: z.boolean().optional(),
            }),
          )
          .max(30),
      }),
    )
    .max(12),
});

export async function cvRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  /**
   * Pemilik melihat CV utuh. Pemberi Kerja hanya bisa membuka CV yang dilampirkan
   * pada Lamaran ke Lowongan miliknya, dengan kontak tersembunyi sampai Lolos.
   */
  async function access(user: SessionUser, id: string) {
    const cv = await db.query.cvKhusus.findFirst({ where: eq(cvKhusus.id, id) });
    if (!cv) throw new HttpError(404, "cv_tidak_ada", "CV Khusus tidak ditemukan.");
    if (cv.userId === user.id) return { cv, masked: false, owner: true };
    if (user.role === "pemberi") {
      const link = await db
        .select({ status: lamaran.status })
        .from(lamaran)
        .innerJoin(lowongan, eq(lowongan.id, lamaran.lowonganId))
        .innerJoin(employers, eq(employers.id, lowongan.employerId))
        .where(and(eq(lamaran.cvKhususId, id), eq(employers.userId, user.id)))
        .then((rows) => rows[0]);
      if (link) return { cv, masked: link.status !== "lolos", owner: false };
    }
    throw new HttpError(404, "cv_tidak_ada", "CV Khusus tidak ditemukan.");
  }

  app.post("/cv", async (request) => {
    const user = requireUser(request, "pencari");
    const body = parse(
      z.object({
        lowongan_id: z.string().uuid(),
        persona_id: z.string().uuid(),
        template: z.enum(["satu_kolom", "dua_kolom"]).optional(),
      }),
      request.body,
    );
    return siapkanCvKhusus(db, ctx.models, user.id, body);
  });

  app.get("/cv/:id", async (request) => {
    const user = requireUser(request);
    const { cv, masked, owner } = await access(user, parse(idParam, request.params).id);
    const isi = masked ? { ...cv.isi, kontak: { kota: cv.isi.kontak.kota } } : cv.isi;
    return {
      id: cv.id,
      template: cv.template,
      bahasa: cv.language,
      isi,
      ...(owner ? { isi_awal: cv.isiAwal } : {}),
      kontak_disembunyikan: masked,
      peringatan: cv.template === "dua_kolom" ? "Templat dua kolom kurang ramah ATS." : null,
    };
  });

  /** Simpan hasil editor WYSIWYG; poin baru dikembalikan sebagai calon Fakta. */
  app.patch("/cv/:id", async (request) => {
    const user = requireUser(request, "pencari");
    const { id } = parse(idParam, request.params);
    const body = parse(z.object({ isi: isiSchema, template: z.enum(["satu_kolom", "dua_kolom"]).optional() }), request.body);
    return simpanEditCv(db, user.id, id, body);
  });

  app.get("/cv/:id/html", async (request, reply) => {
    const user = requireUser(request);
    const { cv, masked } = await access(user, parse(idParam, request.params).id);
    reply.type("text/html; charset=utf-8");
    return renderCvHtml(cv.isi, cv.template, masked, cv.language);
  });

  app.get("/cv/:id/pdf", async (request, reply) => {
    const user = requireUser(request);
    const { cv, masked } = await access(user, parse(idParam, request.params).id);
    let pdf: Uint8Array;
    try {
      pdf = await htmlToPdf(renderCvHtml(cv.isi, cv.template, masked, cv.language), ctx.env.CHROMIUM_PATH);
    } catch (error) {
      request.log.error({ err: error }, "render PDF gagal");
      throw new HttpError(503, "pdf_gagal", "PDF belum bisa dibuat. Pakai tombol Cetak di browser sebagai cadangan.");
    }
    const safeName = cv.isi.nama.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "CV";
    reply
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="CV_${safeName}.pdf"`)
      .header("Cache-Control", "private, no-store");
    return Buffer.from(pdf);
  });
}
