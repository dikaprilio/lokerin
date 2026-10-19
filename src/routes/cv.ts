import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { cvKhusus, employers, lamaran, lowongan, type IsiCv } from "../db/schema.js";
import { HttpError, requireUser, type SessionUser } from "../auth/session.js";
import { siapkanCvKhusus, simpanEditCv } from "../cv/generate.js";
import { renderCvHtml } from "../cv/template.js";
import { normalisasiIsi } from "../cv/isi.js";
import { htmlToPdf } from "../cv/pdf.js";
import { idParam, parse } from "./util.js";

const teks = (max: number) => z.string().max(max);
const idCv = z.string().max(64);
const poinSchema = z.object({ id: idCv, text: teks(600), fakta_ids: z.array(z.string()).max(10), diedit_pengguna: z.boolean().optional() });

const isiSchema: z.ZodType<IsiCv> = z.object({
  versi: z.literal(2),
  nama: teks(120),
  judul: teks(160),
  kontak: z.object({
    telepon: teks(40).optional(),
    email: teks(120).optional(),
    kota: teks(80).optional(),
    tautan: z.array(teks(200)).max(5).optional(),
  }),
  ringkasan: teks(2000),
  keahlian: z.array(z.object({ id: idCv, label: teks(60), isi: z.array(teks(80)).max(20) })).max(8),
  bagian: z
    .array(
      z.object({
        id: idCv,
        judul: teks(80),
        jenis: z.enum(["pengalaman", "pendidikan", "proyek", "prestasi", "lainnya"]),
        entri: z
          .array(
            z.object({
              id: idCv,
              judul: teks(160),
              tempat: teks(160).optional(),
              keterangan: teks(120).optional(),
              periode: teks(60).optional(),
              lokasi: teks(80).optional(),
              poin: z.array(poinSchema).max(12),
              fakta_ids: z.array(z.string()).max(20),
              diedit_pengguna: z.boolean().optional(),
            }),
          )
          .max(20),
      }),
    )
    .max(12),
});

/** Nama berkas yang dikenali orang di folder Unduhan: "CV - Sari Wulandari - Juru Masak.pdf". */
function namaBerkas(isi: IsiCv) {
  const bersih = (v: string) => v.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return ["CV", bersih(isi.nama), bersih(isi.judul)].filter(Boolean).join(" - ") + ".pdf";
}

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
    const lengkap = normalisasiIsi(cv.isi);
    const isi = masked ? { ...lengkap, kontak: { kota: lengkap.kontak.kota } } : lengkap;
    return {
      id: cv.id,
      template: cv.template,
      bahasa: cv.language,
      isi,
      ...(owner ? { isi_awal: normalisasiIsi(cv.isiAwal) } : {}),
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
    return renderCvHtml(normalisasiIsi(cv.isi), cv.template, masked, cv.language);
  });

  /** `?unduh=1` meminta berkas diunduh; tanpa itu PDF dibuka di tab browser. */
  app.get("/cv/:id/pdf", async (request, reply) => {
    const user = requireUser(request);
    const { cv, masked } = await access(user, parse(idParam, request.params).id);
    const { unduh } = parse(z.object({ unduh: z.string().optional() }), request.query ?? {});
    const isi = normalisasiIsi(cv.isi);
    let pdf: Uint8Array;
    try {
      pdf = await htmlToPdf(renderCvHtml(isi, cv.template, masked, cv.language), ctx.env.CHROMIUM_PATH);
    } catch (error) {
      request.log.error({ err: error }, "render PDF gagal");
      throw new HttpError(503, "pdf_gagal", "PDF belum bisa dibuat. Pakai tombol Cetak di browser sebagai cadangan.");
    }
    const nama = namaBerkas(isi);
    const ascii = nama.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    reply
      .type("application/pdf")
      .header("Content-Disposition", `${unduh ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nama)}`)
      .header("Access-Control-Expose-Headers", "Content-Disposition")
      .header("Cache-Control", "private, no-store");
    return Buffer.from(pdf);
  });
}
