import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "./config/env.js";
import { createDb } from "./db/client.js";
import { EventBus, cityChannel, publicChannel, userChannel } from "./events/bus.js";
import { createModels } from "./ai/models.js";
import { createMastra } from "./ai/agent.js";
import { HttpError, readToken, tokenFromRequest } from "./auth/session.js";
import { LiveVoice } from "./voice/live.js";
import { closeBrowser } from "./cv/pdf.js";
import type { AppContext } from "./context.js";
import { authRoutes } from "./routes/auth.js";
import { tamuRoutes } from "./routes/tamu.js";
import { lowonganRoutes } from "./routes/lowongan.js";
import { profilRoutes } from "./routes/profil.js";
import { lamaranRoutes } from "./routes/lamaran.js";
import { cvRoutes } from "./routes/cv.js";
import { chatRoutes } from "./routes/chat.js";
import { kabarRoutes } from "./routes/kabar.js";
import { aturPush } from "./kabar/push.js";
import { pasangCacheHttp } from "./http/cache.js";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "production" ? "info" : "debug", redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const { db, pool } = createDb(env.DATABASE_URL, (error) => app.log.warn({ err: error }, "koneksi database terputus; dibuka ulang saat dibutuhkan"));
  const models = createModels(env);
  const bus = new EventBus();
  const { mastra, agent, memory } = createMastra(db, pool, models, { bus, env });
  const ctx: AppContext = { env, db, pool, models, bus, mastra };
  const live = new LiveVoice(env, agent, bus, app.log);

  const allowedOrigins = new Set(env.FRONTEND_ORIGINS);
  const originAllowed = (origin?: string) =>
    !origin || allowedOrigins.has(origin) || (env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin));

  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: (origin, callback) => callback(null, originAllowed(origin)),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    allowList: (request) => request.url.startsWith("/events") || request.url === "/healthz",
  });

  pasangCacheHttp(app);

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    request.user = readToken(tokenFromRequest(request), env.SESSION_SECRET);
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ galat: error.code, pesan: error.message });
    }
    if ((error as FastifyError).statusCode === 429) {
      return reply.code(429).send({ galat: "terlalu_sering", pesan: "Terlalu banyak permintaan. Tunggu sebentar." });
    }
    request.log.error({ err: error }, "galat tak terduga");
    return reply.code(500).send({ galat: "server", pesan: "Terjadi kesalahan di server. Coba lagi." });
  });

  app.get("/healthz", async () => {
    await pool.query("select 1");
    return { ok: true, sse: bus.size, suara: live.activeCount };
  });

  /** Aliran pembaruan langsung (SSE): feed publik, kota, dan kanal pribadi pengguna. */
  app.get("/events", async (request, reply) => {
    const { kota } = (request.query ?? {}) as { kota?: string };
    const channels = [publicChannel];
    if (kota) channels.push(cityChannel(kota));
    if (request.user) channels.push(userChannel(request.user.id));
    const origin = request.headers.origin;
    bus.subscribe(reply, channels, origin && originAllowed(origin) ? origin : undefined);
  });

  await authRoutes(app, ctx);
  await tamuRoutes(app, ctx);
  await lowonganRoutes(app, ctx);
  await profilRoutes(app, ctx);
  await lamaranRoutes(app, ctx);
  await cvRoutes(app, ctx);
  await chatRoutes(app, ctx, memory, live);
  await kabarRoutes(app, ctx);
  aturPush(env, app.log);

  app.addHook("onClose", async () => {
    await live.shutdown();
    await closeBrowser();
    await pool.end();
  });

  return app;
}
