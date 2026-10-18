import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireUser } from "../auth/session.js";
import {
  kirimLamaran,
  lamaranMasuk,
  lamaranPencari,
  lamaranUntuk,
  tambahTahap,
  tandaiDilihat,
  tandaiLolos,
  tandaiTidakLolos,
} from "../domain/lamaran.js";
import { idParam, parse } from "./util.js";

const tahapSchema = z.object({
  jenis: z.enum(["whatsapp", "meet", "alamat", "lainnya"]),
  detail: z.string().min(3).max(500),
  jadwal: z.string().datetime({ offset: true }).nullable().optional(),
  catatan: z.string().max(500).nullable().optional(),
});

export async function lamaranRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, bus } = ctx;

  /** Aksi final: tombol Kirim Lamaran (ADR 0004). */
  app.post("/lamaran", async (request, reply) => {
    const user = requireUser(request, "pencari");
    const body = parse(
      z.object({
        lowongan_id: z.string().uuid(),
        persona_id: z.string().uuid(),
        cv_khusus_id: z.string().uuid().nullable().optional(),
        pesan: z.string().max(1000).nullable().optional(),
      }),
      request.body,
    );
    reply.code(201);
    return kirimLamaran(db, bus, user.id, body);
  });

  app.get("/pencari/lamaran", async (request) => ({ lamaran: await lamaranPencari(db, requireUser(request, "pencari").id) }));

  app.get("/pemberi/lamaran", async (request) => {
    const user = requireUser(request, "pemberi");
    const { lowongan_id } = parse(z.object({ lowongan_id: z.string().uuid().optional() }), request.query);
    return { lamaran: await lamaranMasuk(db, user.id, lowongan_id) };
  });

  app.get("/lamaran/:id", async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    return lamaranUntuk(db, user.id, user.role, id);
  });

  app.post("/lamaran/:id/dilihat", async (request) => {
    const user = requireUser(request, "pemberi");
    return tandaiDilihat(db, bus, user.id, parse(idParam, request.params).id);
  });

  /** Aksi final: Lolos selalu disertai Tahap Berikutnya. */
  app.post("/lamaran/:id/lolos", async (request) => {
    const user = requireUser(request, "pemberi");
    const { id } = parse(idParam, request.params);
    return tandaiLolos(db, bus, user.id, id, parse(tahapSchema, request.body));
  });

  app.post("/lamaran/:id/tidak-lolos", async (request) => {
    const user = requireUser(request, "pemberi");
    return tandaiTidakLolos(db, bus, user.id, parse(idParam, request.params).id);
  });

  app.post("/lamaran/:id/tahap", async (request) => {
    const user = requireUser(request, "pemberi");
    const { id } = parse(idParam, request.params);
    return tambahTahap(db, bus, user.id, id, parse(tahapSchema, request.body));
  });
}
