import type { FastifyReply } from "fastify";

/**
 * Penerbit event di memori untuk satu instance Fastify. Sumber kebenaran tetap
 * di Postgres: event hanya memberi tahu layar agar memperbarui diri, dan klien
 * memuat ulang data yang terlewat setelah tersambung kembali.
 */
export type LiveEvent = { type: string; data: unknown };

type Subscriber = { channels: Set<string>; reply: FastifyReply };

export const publicChannel = "publik";
export const cityChannel = (city: string) => `kota:${city.trim().toLowerCase()}`;
export const userChannel = (userId: string) => `user:${userId}`;

export class EventBus {
  private subscribers = new Set<Subscriber>();
  private sequence = 0;

  publish(channels: string[], event: LiveEvent) {
    const id = ++this.sequence;
    const frame = `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const subscriber of this.subscribers) {
      if (!channels.some((channel) => subscriber.channels.has(channel))) continue;
      try {
        subscriber.reply.raw.write(frame);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  /** Menahan respons SSE terbuka; heartbeat mencegah Azure App Service memutus koneksi yang tampak diam. */
  subscribe(reply: FastifyReply, channels: string[], origin?: string) {
    reply.hijack();
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Credentials"] = "true";
      headers.Vary = "Origin";
    }
    reply.raw.writeHead(200, headers);
    reply.raw.write(`retry: 3000\nevent: siap\ndata: ${JSON.stringify({ channels })}\n\n`);
    const subscriber: Subscriber = { channels: new Set(channels), reply };
    this.subscribers.add(subscriber);
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      this.subscribers.delete(subscriber);
    };
    reply.raw.on("close", cleanup);
  }

  get size() {
    return this.subscribers.size;
  }
}
