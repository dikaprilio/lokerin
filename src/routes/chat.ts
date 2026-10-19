import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { createUIMessageStreamResponse } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY, RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireUser, type SessionUser } from "../auth/session.js";
import { AGENT_ID } from "../ai/agent.js";
import type { LokerinRequestContext } from "../ai/tools.js";
import type { Memory } from "@mastra/memory";
import type { LiveVoice } from "../voice/live.js";
import { parse } from "./util.js";

/** Thread selalu diawali id pengguna agar riwayat orang lain tidak bisa dibuka. */
export function threadFor(userId: string, clientId?: string) {
  const suffix = (clientId ?? "utama").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "utama";
  return `${userId}:${suffix}`;
}

export function contextFor(user: SessionUser, threadId: string, kanal: "teks" | "suara") {
  const requestContext = new RequestContext<LokerinRequestContext>();
  requestContext.set("user", user);
  requestContext.set("kanal", kanal);
  requestContext.set(MASTRA_RESOURCE_ID_KEY as never, user.id as never);
  requestContext.set(MASTRA_THREAD_ID_KEY as never, threadId as never);
  return requestContext;
}

/** Judul obrolan dari pesan pertama, dipotong di batas kata: "Cari kerja kasir di Purwokerto…". */
export function judulDari(teks: string) {
  const bersih = teks.replace(/\s+/g, " ").trim();
  if (!bersih) return "Obrolan baru";
  const potong = bersih.length > 44 ? `${bersih.slice(0, 44).replace(/\s+\S*$/, "")}…` : bersih;
  return potong.charAt(0).toUpperCase() + potong.slice(1);
}

function teksPesan(pesan: unknown) {
  const parts = (pesan as { parts?: { type: string; text?: string }[] })?.parts ?? [];
  return parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join(" ");
}

export async function chatRoutes(app: FastifyInstance, ctx: AppContext, memory: Memory, live: LiveVoice) {
  /** Membuat obrolan dengan judul dari pesan pertamanya; obrolan lama tidak diubah. */
  async function pastikanObrolan(userId: string, threadId: string, teks: string) {
    const ada = await memory.getThreadById({ threadId });
    if (ada) return;
    await memory.createThread({ threadId, resourceId: userId, title: judulDari(teks) });
  }

  /** Daftar obrolan pengguna, terbaru dulu. `id` adalah id dari klien, tanpa awalan id pengguna. */
  app.get("/chat/obrolan", async (request) => {
    const user = requireUser(request);
    const { threads } = await memory.listThreads({
      filter: { resourceId: user.id },
      orderBy: { field: "updatedAt", direction: "DESC" },
      perPage: 50,
    } as never);
    return {
      obrolan: threads
        .filter((t) => t.id.startsWith(`${user.id}:`))
        .map((t) => ({
          id: t.id.slice(user.id.length + 1),
          judul: t.title?.trim() || "Obrolan",
          diperbarui_pada: new Date(t.updatedAt).toISOString(),
        })),
    };
  });

  app.delete("/chat/obrolan/:id", async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), request.params);
    const threadId = threadFor(user.id, id);
    const thread = await memory.getThreadById({ threadId });
    if (thread && thread.resourceId === user.id) await memory.deleteThread(threadId);
    return { ok: true };
  });

  /** Obrolan teks untuk `useChat` (AI SDK v7). Server menyimpan riwayat; klien cukup mengirim pesan terbaru. */
  app.post("/chat", async (request, reply) => {
    const user = requireUser(request);
    const body = parse(z.object({ id: z.string().optional(), messages: z.array(z.any()).min(1) }), request.body);
    const threadId = threadFor(user.id, body.id);
    const latest = body.messages[body.messages.length - 1];
    await pastikanObrolan(user.id, threadId, teksPesan(latest));
    const stream = await handleChatStream({
      mastra: ctx.mastra,
      agentId: AGENT_ID,
      version: "v7",
      params: {
        messages: [latest],
        memory: { thread: threadId, resource: user.id },
        requestContext: contextFor(user, threadId, "teks"),
        maxSteps: 8,
      },
      onError: () => "Maaf, asisten sedang bermasalah. Coba lagi sebentar.",
    });
    const response = createUIMessageStreamResponse({ stream: stream as never });
    response.headers.forEach((value, key) => reply.header(key, value));
    reply.header("X-Accel-Buffering", "no");
    return reply.send(Readable.fromWeb(response.body as never));
  });

  app.get("/chat/riwayat", async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.string().optional() }), request.query);
    const threadId = threadFor(user.id, id);
    const thread = await memory.getThreadById({ threadId });
    if (!thread || thread.resourceId !== user.id) return { id: threadId, messages: [] };
    const { messages } = await memory.recall({ threadId, resourceId: user.id, perPage: 40 } as never);
    return { id: threadId, messages: toAISdkMessages(messages as never, { version: "v7" }) };
  });

  /** Panggilan suara gpt-live-1: browser mengirim offer WebRTC, server mengembalikan answer. */
  app.post("/suara/sesi", async (request) => {
    const user = requireUser(request);
    const body = parse(z.object({ sdp: z.string().min(10).max(20_000), thread_id: z.string().optional() }), request.body);
    const threadId = threadFor(user.id, body.thread_id);
    await pastikanObrolan(user.id, threadId, "Obrolan suara");
    return live.open(user, body.sdp, threadId);
  });

  app.delete("/suara/sesi/:id", async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.string().min(1).max(200) }), request.params);
    await live.close(user, id);
    return { ok: true };
  });
}
