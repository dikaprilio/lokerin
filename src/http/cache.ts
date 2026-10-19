import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Bacaan publik yang sama untuk semua orang. Tanpa sesi, jawabannya boleh disimpan sebentar oleh
 * browser dan CDN; dengan sesi (misalnya pemilik melihat draf lowongannya) hanya browser itu yang
 * boleh menyimpan dan selalu bertanya dulu. Selain rute ini, jawaban GET tidak pernah disimpan,
 * supaya data pribadi tidak tertinggal di HP yang dipakai bergantian.
 */
const RUTE_PUBLIK = new Set(["/lowongan", "/lowongan/:id", "/lowongan/peta", "/lowongan/statistik", "/kartu-kerja/:id", "/auth/akun-demo", "/push/kunci"]);

export function pasangCacheHttp(app: FastifyInstance) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET" || reply.statusCode !== 200 || reply.getHeader("cache-control")) return payload;
    if (!RUTE_PUBLIK.has(request.routeOptions.url ?? "")) {
      reply.header("cache-control", "private, no-store");
      return payload;
    }
    if (typeof payload !== "string") return payload;
    // ETag lemah dari isi jawaban: kalau browser sudah punya versi yang sama, cukup balas 304.
    const etag = `W/"${createHash("sha1").update(payload).digest("base64url")}"`;
    reply.header("etag", etag);
    reply.header("cache-control", request.user ? "private, no-cache" : "public, max-age=15, stale-while-revalidate=60");
    if (request.headers["if-none-match"]?.split(/\s*,\s*/).includes(etag)) {
      reply.code(304);
      return "";
    }
    return payload;
  });
}

/** Mengingat hasil `muat` selama `ms`; permintaan yang datang bersamaan berbagi satu janji. */
export function ingat<T>(ms: number, muat: () => Promise<T>) {
  let simpanan: { sampai: number; janji: Promise<T> } | null = null;
  return () => {
    const sekarang = Date.now();
    if (simpanan && simpanan.sampai > sekarang) return simpanan.janji;
    const janji = muat();
    simpanan = { sampai: sekarang + ms, janji };
    // Kegagalan tidak diingat: permintaan berikutnya mencoba lagi.
    janji.catch(() => {
      if (simpanan?.janji === janji) simpanan = null;
    });
    return janji;
  };
}
