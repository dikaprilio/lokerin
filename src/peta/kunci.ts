import { z } from "zod";
import type { Env } from "../config/env.js";

/*
 * Token peta untuk browser. Token rahasia Mapbox tidak boleh ada di frontend, jadi server membuat
 * token sementara (tk.*) lewat Mapbox Tokens API dengan izin baca saja dan umur 55 menit, lalu
 * menyimpannya di memori sampai hampir kedaluwarsa. Dokumentasi:
 * https://docs.mapbox.com/api/accounts/tokens/#create-a-temporary-token
 */

const IZIN = ["styles:read", "styles:tiles", "fonts:read"] as const;
const UMUR_MS = 55 * 60_000;
const SEGARKAN_MS = 5 * 60_000;

export type KunciPeta = { aktif: true; token: string; kedaluwarsa: string; gaya: string } | { aktif: false };

const jawaban = z.object({ token: z.string().regex(/^tk\.[\w-]+\.[\w-]+$/).max(4096) });

function pemilik(rahasia: string) {
  const isi = rahasia.split(".")[1];
  if (!isi) return null;
  try {
    const data = JSON.parse(Buffer.from(isi, "base64url").toString("utf8")) as { u?: unknown };
    return typeof data.u === "string" && /^[\w-]{1,64}$/.test(data.u) ? data.u : null;
  } catch {
    return null;
  }
}

export function buatKunciPeta(env: Env, log: { warn: (o: object, m: string) => void }) {
  let simpanan: { token: string; kedaluwarsa: number } | null = null;
  let menunggu: Promise<{ token: string; kedaluwarsa: number }> | null = null;

  async function buat() {
    const rahasia = env.MAPBOX_SECRET_TOKEN ?? "";
    const akun = rahasia.startsWith("sk.") ? pemilik(rahasia) : null;
    if (!akun) throw new Error("MAPBOX_SECRET_TOKEN bukan token rahasia yang sah");
    const kedaluwarsa = Date.now() + UMUR_MS;
    const url = new URL(`https://api.mapbox.com/tokens/v2/${encodeURIComponent(akun)}`);
    url.searchParams.set("access_token", rahasia);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expires: new Date(kedaluwarsa).toISOString(), scopes: IZIN }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // The response or the request URL can contain the secret, so neither is logged.
    if (!res.ok) throw new Error(`Mapbox menolak membuat token sementara (HTTP ${res.status})`);
    const { token } = jawaban.parse(await res.json());
    return { token, kedaluwarsa };
  }

  return async function kunci(): Promise<KunciPeta> {
    if (!env.MAPBOX_SECRET_TOKEN) return { aktif: false };
    try {
      if (!simpanan || simpanan.kedaluwarsa - Date.now() < SEGARKAN_MS) {
        menunggu ??= buat();
        try {
          simpanan = await menunggu;
        } finally {
          menunggu = null;
        }
      }
      return { aktif: true, token: simpanan.token, kedaluwarsa: new Date(simpanan.kedaluwarsa).toISOString(), gaya: "mapbox://styles/mapbox/light-v11" };
    } catch (galat) {
      log.warn({ pesan: (galat as Error).message }, "token peta gagal dibuat");
      return { aktif: false };
    }
  };
}
