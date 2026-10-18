import { createHmac, timingSafeEqual } from "node:crypto";
import "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Peran } from "../db/schema.js";

export const SESSION_COOKIE = "lokerin_sesi";
const SESSION_DAYS = 7;

export type SessionUser = { id: string; role: Peran };

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

type Payload = { uid: string; role: Peran; exp: number };

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueToken(user: SessionUser, secret: string) {
  const payload: Payload = {
    uid: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readToken(token: string | undefined, secret: string): SessionUser | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (payload.exp * 1000 < Date.now()) return null;
    if (payload.role !== "pencari" && payload.role !== "pemberi") return null;
    return { id: payload.uid, role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Sesi dibaca dari cookie (frontend satu origin lewat rewrite), header Bearer
 * (frontend beda origin), atau `?token=` khusus EventSource yang tidak bisa mengirim header.
 */
export function tokenFromRequest(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const query = request.query as { token?: unknown } | undefined;
  return typeof query?.token === "string" ? query.token : undefined;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireUser(request: FastifyRequest, role?: Peran): SessionUser {
  if (!request.user) throw new HttpError(401, "belum_masuk", "Masuk dulu dengan akun demo.");
  if (role && request.user.role !== role) {
    throw new HttpError(
      403,
      "peran_salah",
      role === "pemberi" ? "Fitur ini khusus Pemberi Kerja." : "Fitur ini khusus Pencari Kerja.",
    );
  }
  return request.user;
}
