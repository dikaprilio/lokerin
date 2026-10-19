import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, gt, gte, ilike, isNotNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { employers, lamaran, laporan, lowongan } from "../db/schema.js";
import { HttpError, requireUser } from "../auth/session.js";
import { cityChannel, publicChannel } from "../events/bus.js";
import { cariLowongan, embedLowongan, lowonganDiSekitar } from "../domain/matching.js";
import { buatDraf, employerOf, periksaUlang, ubahDraf, type IsiDraf } from "../domain/lowongan.js";
import { kartuLowongan } from "../domain/serialize.js";
import { kirimKabar, penerimaButuhHariIni } from "../kabar/kabar.js";
import { idParam, parse } from "./util.js";

const jenisUpah = z.enum(["harian", "mingguan", "bulanan", "borongan", "per_jam"]);

const drafSchema = z
  .object({
    title: z.string().max(120),
    category: z.string().max(40),
    segment: z.enum(["informal", "magang"]),
    description: z.string().max(4000),
    requirements: z.array(z.string().max(200)).max(20),
    payType: jenisUpah,
    payMin: z.number().int().nonnegative(),
    payMax: z.number().int().nonnegative(),
    hoursPerDay: z.number().positive().max(24),
    daysPerWeek: z.number().int().min(1).max(7),
    hoursText: z.string().max(60),
    employmentType: z.enum(["harian", "paruh_waktu", "kontrak", "tetap", "magang"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    city: z.string().max(80),
    district: z.string().max(80),
    address: z.string().max(240),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    urgentHours: z.number().int().min(1).max(24).nullable(),
    language: z.enum(["id", "en"]),
  })
  .partial();

const feedQuery = z.object({
  kota: z.string().optional(),
  kategori: z.string().optional(),
  segmen: z.enum(["informal", "magang"]).optional(),
  jenis_upah: jenisUpah.optional(),
  butuh_hari_ini: z.coerce.boolean().optional(),
  q: z.string().optional(),
  batas: z.coerce.number().int().min(1).max(100).default(50),
});

export async function lowonganRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  /** Feed Lowongan Terbit dengan filter kota, kategori, dan jenis upah. */
  app.get("/lowongan", async (request) => {
    const query = parse(feedQuery, request.query);
    const filters: SQL[] = [eq(lowongan.status, "terbit")];
    if (query.kota) {
      const kota = or(ilike(lowongan.city, `%${query.kota}%`), ilike(lowongan.district, `%${query.kota}%`));
      if (kota) filters.push(kota);
    }
    if (query.kategori) filters.push(eq(lowongan.category, query.kategori));
    if (query.segmen) filters.push(eq(lowongan.segment, query.segmen));
    if (query.jenis_upah) filters.push(eq(lowongan.payType, query.jenis_upah));
    if (query.butuh_hari_ini) filters.push(isNotNull(lowongan.urgentUntil), gt(lowongan.urgentUntil, new Date()));
    if (query.q) {
      const teks = or(ilike(lowongan.title, `%${query.q}%`), ilike(lowongan.description, `%${query.q}%`));
      if (teks) filters.push(teks);
    }
    const rows = await db
      .select({ lowongan, employer: employers })
      .from(lowongan)
      .innerJoin(employers, eq(employers.id, lowongan.employerId))
      .where(and(...filters))
      .orderBy(desc(lowongan.urgentUntil), desc(lowongan.publishedAt))
      .limit(query.batas);
    return { lowongan: rows.map((row) => kartuLowongan(row.lowongan, row.employer)) };
  });

  /** Pencarian dengan Preferensi Wajib dan kemiripan vektor (dipakai juga oleh agen). */
  app.post("/lowongan/cari", async (request) => {
    const body = parse(
      z.object({
        kueri: z.string().optional(),
        kota: z.array(z.string()).optional(),
        kategori: z.string().optional(),
        segmen: z.enum(["informal", "magang"]).optional(),
        jenis_upah: z.string().optional(),
        upah_min_bulanan: z.number().int().optional(),
        butuh_hari_ini: z.boolean().optional(),
        persona_id: z.string().uuid().optional(),
        batas: z.number().int().min(1).max(20).optional(),
      }),
      request.body,
    );
    return cariLowongan(db, ctx.models, request.user?.id ?? null, body);
  });

  /** Peta Kerja Sekitar. */
  app.get("/lowongan/peta", async (request) => {
    const query = parse(
      z.object({
        lat: z.coerce.number().default(-7.4246),
        lng: z.coerce.number().default(109.2343),
        radius_km: z.coerce.number().min(0.5).max(50).default(8),
      }),
      request.query,
    );
    return { pusat: { lat: query.lat, lng: query.lng }, lowongan: await lowonganDiSekitar(db, query.lat, query.lng, query.radius_km) };
  });

  /** Penghitung di halaman utama. */
  app.get("/lowongan/statistik", async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [terbit] = await db.select({ n: count() }).from(lowongan).where(eq(lowongan.status, "terbit"));
    const [hariIni] = await db
      .select({ n: count() })
      .from(lowongan)
      .where(and(eq(lowongan.status, "terbit"), gte(lowongan.publishedAt, startOfDay)));
    const [mendadak] = await db
      .select({ n: count() })
      .from(lowongan)
      .where(and(eq(lowongan.status, "terbit"), gt(lowongan.urgentUntil, new Date())));
    const [terverifikasi] = await db.select({ n: count() }).from(employers).where(eq(employers.status, "terverifikasi"));
    return {
      lowongan_terbit: Number(terbit?.n ?? 0),
      lowongan_hari_ini: Number(hariIni?.n ?? 0),
      butuh_hari_ini: Number(mendadak?.n ?? 0),
      pemberi_kerja_terverifikasi: Number(terverifikasi?.n ?? 0),
    };
  });

  app.get("/lowongan/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    const row = await db
      .select({ lowongan, employer: employers })
      .from(lowongan)
      .innerJoin(employers, eq(employers.id, lowongan.employerId))
      .where(eq(lowongan.id, id))
      .then((rows) => rows[0]);
    const isOwner = row && request.user?.role === "pemberi" && row.employer.userId === request.user.id;
    if (!row || (row.lowongan.status !== "terbit" && !isOwner)) {
      throw new HttpError(404, "lowongan_tidak_ada", "Lowongan tidak ditemukan.");
    }
    return kartuLowongan(row.lowongan, row.employer);
  });

  app.post("/lowongan/:id/laporkan", async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const { alasan } = parse(z.object({ alasan: z.string().min(3).max(500) }), request.body);
    await db.insert(laporan).values({ lowonganId: id, pelaporId: user.id, alasan });
    return { ok: true, pesan: "Terima kasih. Laporan akan ditinjau." };
  });

  // --- Pemberi Kerja ---

  app.get("/pemberi/lowongan", async (request) => {
    const user = requireUser(request, "pemberi");
    const employer = await employerOf(db, user.id);
    const rows = await db
      .select({ lowongan, jumlah: count(lamaran.id) })
      .from(lowongan)
      .leftJoin(lamaran, eq(lamaran.lowonganId, lowongan.id))
      .where(eq(lowongan.employerId, employer.id))
      .groupBy(lowongan.id)
      .orderBy(desc(lowongan.updatedAt));
    return { lowongan: rows.map((row) => kartuLowongan(row.lowongan, employer, { jumlah_lamaran: Number(row.jumlah) })) };
  });

  /** Draf lewat formulir (jalur ketuk-dan-ketik); jalur suara/teks memakai alat agen yang sama. */
  app.post("/pemberi/lowongan", async (request) => {
    const user = requireUser(request, "pemberi");
    const isi = parse(drafSchema, request.body) as IsiDraf;
    return buatDraf(db, user.id, isi);
  });

  app.patch("/pemberi/lowongan/:id", async (request) => {
    const user = requireUser(request, "pemberi");
    const { id } = parse(idParam, request.params);
    return ubahDraf(db, user.id, id, parse(drafSchema, request.body) as IsiDraf);
  });

  /** Aksi final: Terbit hanya lewat tombol, dan hanya bila Pemeriksaan tidak menahan (ADR 0004). */
  app.post("/pemberi/lowongan/:id/terbit", async (request) => {
    const user = requireUser(request, "pemberi");
    const { id } = parse(idParam, request.params);
    const card = await periksaUlang(db, user.id, id);
    if (!card.pemeriksaan?.boleh_terbit) {
      throw new HttpError(422, "pemeriksaan_menahan", "Lowongan belum bisa terbit. Lengkapi yang ditandai Pemeriksaan.");
    }
    const now = new Date();
    await db.update(lowongan).set({ status: "terbit", publishedAt: now, updatedAt: now }).where(eq(lowongan.id, id));
    await embedLowongan(db, ctx.models, [id]);
    const row = await db
      .select({ lowongan, employer: employers })
      .from(lowongan)
      .innerJoin(employers, eq(employers.id, lowongan.employerId))
      .where(eq(lowongan.id, id))
      .then((rows) => rows[0]);
    if (!row) throw new Error("Lowongan hilang setelah terbit");
    const published = kartuLowongan(row.lowongan, row.employer);
    const channels = [publicChannel, ...(row.lowongan.city ? [cityChannel(row.lowongan.city)] : [])];
    ctx.bus.publish(channels, { type: published.butuh_hari_ini ? "butuh_hari_ini" : "lowongan.baru", data: published });
    if (published.butuh_hari_ini) void kabarButuhHariIni(row.lowongan, row.employer);
    return published;
  });

  /** Kabar untuk Pencari Kerja di kota yang sama yang Personanya cocok; berjalan setelah respons dikirim. */
  async function kabarButuhHariIni(row: typeof lowongan.$inferSelect, employer: typeof employers.$inferSelect) {
    const penerima = await penerimaButuhHariIni(db, row.id, row.city).catch(() => []);
    const tempat = row.district ?? row.city ?? "sekitarmu";
    await kirimKabar(
      db,
      ctx.bus,
      penerima.map((userId) => ({
        userId,
        jenis: "butuh_hari_ini" as const,
        judul: "Butuh hari ini di dekatmu",
        isi: `${employer.businessName} butuh ${row.title} hari ini di ${tempat}.`,
        tautan: `/app/lowongan/${row.id}`,
        push: true,
      })),
    );
  }

  app.post("/pemberi/lowongan/:id/tutup", async (request) => {
    const user = requireUser(request, "pemberi");
    const { id } = parse(idParam, request.params);
    const employer = await employerOf(db, user.id);
    const [row] = await db
      .update(lowongan)
      .set({ status: "terisi", updatedAt: new Date() })
      .where(and(eq(lowongan.id, id), eq(lowongan.employerId, employer.id)))
      .returning();
    if (!row) throw new HttpError(404, "lowongan_tidak_ada", "Lowongan tidak ditemukan.");
    ctx.bus.publish([publicChannel], { type: "lowongan.tutup", data: { id } });
    return kartuLowongan(row, employer);
  });
}
