import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { langgananPush } from "../db/schema.js";
import { HttpError, requireUser } from "../auth/session.js";
import { daftarKabar, tandaiKabarDibaca } from "../kabar/kabar.js";
import { pushAktif } from "../kabar/push.js";
import { parse } from "./util.js";

const langgananSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(10).max(512), auth: z.string().min(8).max(256) }),
});

/** Kabar dan langganan Web Push (ADR 0008). */
export async function kabarRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get("/kabar", async (request) => {
    const user = requireUser(request);
    const { batas } = parse(z.object({ batas: z.coerce.number().int().optional() }), request.query ?? {});
    return daftarKabar(db, user.id, batas);
  });

  /** Tanpa `ids`, semua Kabar ditandai dibaca. */
  app.post("/kabar/baca", async (request) => {
    const user = requireUser(request);
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(100).optional() }), request.body ?? {});
    return tandaiKabarDibaca(db, user.id, ids);
  });

  app.get("/push/kunci", async () => ({ aktif: pushAktif(), kunci_publik: pushAktif() ? ctx.env.VAPID_PUBLIC_KEY : null }));

  app.post("/push/langganan", async (request, reply) => {
    const user = requireUser(request);
    if (!pushAktif()) throw new HttpError(503, "push_belum_aktif", "Pemberitahuan push belum aktif di server ini.");
    const body = parse(langgananSchema, request.body);
    await db
      .insert(langgananPush)
      .values({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth })
      .onConflictDoUpdate({
        target: langgananPush.endpoint,
        set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
      });
    reply.code(201);
    return { ok: true };
  });

  app.delete("/push/langganan", async (request) => {
    const user = requireUser(request);
    const { endpoint } = parse(z.object({ endpoint: z.string().url().max(2048) }), request.body);
    await db.delete(langgananPush).where(and(eq(langgananPush.endpoint, endpoint), eq(langgananPush.userId, user.id)));
    return { ok: true };
  });
}
