import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { SidebandWS } from "openai/resources/live/sideband/ws";
import type { ConnectServerEvent } from "openai/resources/live/sideband/sideband";
import type { Agent } from "@mastra/core/agent";
import { RequestContext, MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../config/env.js";
import { HttpError, type SessionUser } from "../auth/session.js";
import { userChannel, type EventBus } from "../events/bus.js";
import type { LokerinRequestContext } from "../ai/tools.js";

const INSTRUKSI = `Kamu adalah suara Lokerin, platform kerja untuk pekerjaan informal dan magang di Banyumas.
Bicaralah dalam Bahasa Indonesia yang santai, hangat, dan singkat. Ikuti gaya pengguna.
Untuk apa pun yang menyangkut lowongan, profil, pengalaman kerja, CV, lamaran, atau memasang lowongan, SELALU delegasikan ke backend dan tunggu hasilnya.
Jangan pernah mengarang lowongan, upah, nama usaha, atau status lamaran.
Hasil backend sudah tampil sebagai kartu di layar pengguna; sampaikan intinya dalam satu atau dua kalimat.
Kamu tidak bisa menerbitkan lowongan, mengirim lamaran, atau menyimpan data. Minta pengguna mengetuk tombol di layar untuk itu.`;

type Fragment = { text: string; start: number; end: number; used: boolean };

type ActiveCall = {
  id: string;
  user: SessionUser;
  threadId: string;
  socket: SidebandWS;
  fragments: Fragment[];
  queue: Promise<void>;
  timer: NodeJS.Timeout;
  closed: boolean;
};

const commentaryLimit = (text: string) => {
  const encoded = Buffer.from(text);
  return encoded.length <= 480 ? text : `${encoded.subarray(0, 476).toString().replace(/�+$/, "")}…`;
};

/**
 * gpt-live-1 dengan client delegation. Audio mengalir langsung antara browser dan
 * OpenAI lewat WebRTC; Fastify memegang sideband untuk menerima delegasi, menjalankan
 * agen Mastra yang sama dengan obrolan teks, lalu mengembalikan ringkasan untuk diucapkan.
 * Sesi panggilan hanya hidup di proses ini; semua data yang perlu bertahan ditulis ke Postgres.
 */
export class LiveVoice {
  private client: OpenAI;
  private calls = new Map<string, ActiveCall>();

  constructor(
    private env: Env,
    private agent: Agent,
    private bus: EventBus,
    private log: FastifyBaseLogger,
  ) {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY ?? "belum-diatur" });
  }

  get activeCount() {
    return this.calls.size;
  }

  async open(user: SessionUser, sdp: string, threadId: string) {
    if (!this.env.OPENAI_API_KEY) {
      throw new HttpError(503, "suara_belum_aktif", "Panggilan suara belum aktif. Pakai obrolan teks dulu.");
    }
    for (const call of this.calls.values()) {
      if (call.user.id === user.id) await this.close(user, call.id);
    }
    if (this.calls.size >= this.env.LIVE_MAX_SESSIONS) {
      throw new HttpError(503, "suara_penuh", "Panggilan suara sedang penuh. Pakai obrolan teks dulu.");
    }
    const peran = user.role === "pemberi" ? "Pengguna ini Pemberi Kerja yang ingin memasang lowongan atau melihat pelamar." : "Pengguna ini Pencari Kerja.";
    const result = await this.client.live.create(
      {
        session: {
          model: this.env.OPENAI_LIVE_MODEL,
          instructions: `${INSTRUKSI}\n${peran}`,
          audio: { output: { voice: this.env.OPENAI_LIVE_VOICE } },
          delegation: { type: "client" },
          store: false,
          client: {
            data_channel: {
              allowed_client_events: ["session.input_audio.mute", "session.input_audio.unmute", "session.close"],
            },
          },
        },
        transport: { type: "webrtc", sdp },
      } as never,
      { timeout: 20_000 },
    );
    const id = result.session.id;
    const socket = new SidebandWS(this.client, { session_id: id });
    const call: ActiveCall = {
      id,
      user,
      threadId,
      socket,
      fragments: [],
      queue: Promise.resolve(),
      closed: false,
      timer: setTimeout(() => void this.close(user, id).catch(() => {}), this.env.LIVE_MAX_SECONDS * 1000),
    };
    call.timer.unref();
    this.calls.set(id, call);
    socket.on("event", (event: ConnectServerEvent) => this.receive(call, event));
    socket.on("error", (error: unknown) => {
      this.log.warn({ err: error, call: id }, "sideband suara bermasalah");
    });
    this.emit(call, "suara.mulai", { session_id: id, batas_detik: this.env.LIVE_MAX_SECONDS });
    return { session_id: id, sdp: result.transport.sdp, thread_id: threadId };
  }

  async close(user: SessionUser, id: string) {
    const call = this.calls.get(id);
    if (!call || call.user.id !== user.id) throw new HttpError(404, "panggilan_tidak_ada", "Panggilan tidak ditemukan.");
    await this.finish(call, "ditutup");
    await this.client.live.sessions.hangup(id).catch(() => {});
  }

  async shutdown() {
    await Promise.all(
      [...this.calls.values()].map(async (call) => {
        await this.finish(call, "server_berhenti");
        await this.client.live.sessions.hangup(call.id).catch(() => {});
      }),
    );
  }

  private async finish(call: ActiveCall, reason: string) {
    if (call.closed) return;
    call.closed = true;
    clearTimeout(call.timer);
    this.calls.delete(call.id);
    try {
      call.socket.close();
    } catch {
      // sudah tertutup
    }
    this.emit(call, "suara.selesai", { session_id: call.id, alasan: reason });
  }

  private emit(call: ActiveCall, type: string, data: Record<string, unknown>) {
    this.bus.publish([userChannel(call.user.id)], { type, data: { session_id: call.id, ...data } });
  }

  private receive(call: ActiveCall, event: ConnectServerEvent) {
    if (call.closed) return;
    switch (event.type) {
      case "session.input_transcript.delta":
        call.fragments.push({ text: event.delta, start: event.start_ms, end: event.end_ms, used: false });
        if (call.fragments.length > 400) call.fragments.shift();
        this.emit(call, "suara.transkrip", { peran: "pengguna", teks: event.delta, mulai_ms: event.start_ms });
        break;
      case "session.output_transcript.delta":
        this.emit(call, "suara.transkrip", { peran: "lokerin", teks: event.delta, mulai_ms: event.start_ms });
        break;
      case "session.delegation.created":
        if (event.delegation.target !== "client") break;
        call.queue = call.queue.then(() => this.delegate(call, event.delegation.id, event.offset_ms)).catch(() => {});
        break;
      case "session.closed":
        void this.finish(call, "selesai");
        break;
      case "error":
        this.emit(call, "suara.peringatan", { pesan: "Sebagian jawaban suara gagal. Kamu bisa mengulang atau mengetik." });
        break;
      default:
        break;
    }
  }

  /** Ucapan pengguna sejak delegasi sebelumnya menjadi pesan untuk agen. */
  private async takeUtterance(call: ActiveCall, offsetMs: number) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const pending = call.fragments.filter((fragment) => !fragment.used && fragment.start <= offsetMs + 1500);
    for (const fragment of pending) fragment.used = true;
    return pending
      .map((fragment) => fragment.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async delegate(call: ActiveCall, delegationId: string, offsetMs: number) {
    if (call.closed) return;
    const message = await this.takeUtterance(call, offsetMs);
    this.emit(call, "suara.tugas", { delegation_id: delegationId, pesan: message, status: "berjalan" });
    const requestContext = new RequestContext<LokerinRequestContext>();
    requestContext.set("user", call.user);
    requestContext.set("kanal", "suara");
    requestContext.set(MASTRA_RESOURCE_ID_KEY as never, call.user.id as never);
    requestContext.set(MASTRA_THREAD_ID_KEY as never, call.threadId as never);
    try {
      const result = await this.agent.generate(message || "(pengguna diam; tanyakan apa yang bisa dibantu)", {
        memory: { thread: call.threadId, resource: call.user.id },
        requestContext,
        maxSteps: 6,
      });
      for (const toolResult of result.toolResults ?? []) {
        const payload = (toolResult as { payload?: { toolName?: string; result?: unknown } }).payload;
        if (payload?.result && typeof payload.result === "object") {
          this.emit(call, "suara.widget", { delegation_id: delegationId, alat: payload.toolName, hasil: payload.result });
        }
      }
      this.emit(call, "suara.tugas", { delegation_id: delegationId, status: "selesai", jawaban: result.text });
      this.append(call, delegationId, result.text || "Sudah, hasilnya ada di layar.");
    } catch (error) {
      this.log.warn({ err: error, call: call.id }, "delegasi suara gagal");
      this.emit(call, "suara.tugas", { delegation_id: delegationId, status: "gagal" });
      this.append(
        call,
        delegationId,
        "Backend belum berhasil mengambil data. Jangan mengarang hasil. Tawarkan untuk mencoba lagi atau mengetik.",
      );
    }
  }

  private append(call: ActiveCall, delegationId: string, content: string) {
    if (call.closed) return;
    try {
      call.socket.send({
        type: "session.commentary.append",
        event_id: randomUUID(),
        delegation_id: delegationId,
        content: commentaryLimit(content),
      } as never);
    } catch (error) {
      this.log.warn({ err: error, call: call.id }, "gagal mengirim hasil ke sesi suara");
    }
  }
}
