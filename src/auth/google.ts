import { HttpError } from "./session.js";

export type AkunGoogle = { sub: string; email: string | null; nama: string | null };

const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * Memeriksa access token dari Google Identity Services di browser. Token harus diterbitkan untuk
 * Client ID Lokerin sendiri (bukan aplikasi lain), belum kedaluwarsa, dan emailnya terverifikasi.
 */
export async function periksaAksesGoogle(accessToken: string, clientIds: string[]): Promise<AkunGoogle> {
  if (!clientIds.length) throw new HttpError(503, "google_belum_diatur", "Masuk dengan Google belum diaktifkan.");

  const info = await fetch(TOKENINFO, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
    signal: AbortSignal.timeout(8000),
  });
  if (!info.ok) throw new HttpError(401, "google_tidak_sah", "Sesi Google tidak sah. Coba masuk lagi.");
  const token = (await info.json()) as { aud?: string; azp?: string; sub?: string; expires_in?: string };
  const untuk = token.aud ?? token.azp;
  if (!untuk || !clientIds.includes(untuk) || !token.sub || Number(token.expires_in ?? 0) <= 0) {
    throw new HttpError(401, "google_tidak_sah", "Sesi Google tidak sah. Coba masuk lagi.");
  }

  const profil = await fetch(USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!profil.ok) throw new HttpError(401, "google_tidak_sah", "Sesi Google tidak sah. Coba masuk lagi.");
  const p = (await profil.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (p.sub !== token.sub) throw new HttpError(401, "google_tidak_sah", "Sesi Google tidak sah. Coba masuk lagi.");

  return { sub: token.sub, email: p.email && p.email_verified ? p.email : null, nama: p.name?.trim() || null };
}
