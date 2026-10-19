import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../config/env.js";
import type { Db } from "../db/client.js";
import { langgananPush } from "../db/schema.js";

export type IsiPush = { judul: string; isi: string; tautan: string; tag: string };

let aktif = false;
let log: FastifyBaseLogger | null = null;

/** Dipanggil sekali saat server mulai. Tanpa kunci VAPID, push mati dan Kabar hanya tampil di aplikasi. */
export function aturPush(env: Env, logger: FastifyBaseLogger) {
  log = logger;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const subjek = env.VAPID_SUBJECT ?? (env.PUBLIC_WEB_URL.startsWith("https://") ? env.PUBLIC_WEB_URL : "mailto:lokerin@localhost");
  webpush.setVapidDetails(subjek, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  aktif = true;
}

export const pushAktif = () => aktif;
export const logKabar = () => log;

/** Mengirim ke semua perangkat penerima. Langganan yang sudah tidak berlaku (404/410) dihapus. */
export async function kirimPush(db: Db, userIds: string[], isi: IsiPush) {
  if (!aktif || !userIds.length) return;
  const daftar = await db.select().from(langgananPush).where(inArray(langgananPush.userId, userIds));
  const payload = JSON.stringify(isi);
  await Promise.all(
    daftar.map(async (langganan) => {
      try {
        await webpush.sendNotification(
          { endpoint: langganan.endpoint, keys: { p256dh: langganan.p256dh, auth: langganan.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
      } catch (galat) {
        const status = (galat as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(langgananPush).where(eq(langgananPush.id, langganan.id));
        } else {
          log?.warn({ status }, "push Kabar gagal dikirim");
        }
      }
    }),
  );
}
