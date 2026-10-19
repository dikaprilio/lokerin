import { z } from "zod";

const csv = (fallback = "") =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32),
  FRONTEND_ORIGINS: csv(),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  /** Client ID OAuth Google (tipe Web application), dipisah koma. Kosong berarti masuk dengan Google mati. */
  GOOGLE_CLIENT_IDS: csv(),
  /** Kunci VAPID untuk Web Push (npx web-push generate-vapid-keys). Kosong berarti Kabar hanya tampil di aplikasi. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** Kontak untuk layanan push: "mailto:..." atau URL https. */
  VAPID_SUBJECT: z.string().optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-v4.1-flash-1017"),
  OPENROUTER_FALLBACK_MODEL: z.string().default("deepseek/deepseek-v4.1-flash"),
  OPENROUTER_PROVIDERS: csv("cloudflare,deepinfra,inference-net"),
  /** Hanya wajib untuk panggilan suara gpt-live-1 (dan embedding bila EMBEDDING_PROVIDER=openai). */
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(["openrouter", "openai"]).default("openrouter"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_LIVE_MODEL: z.string().default("gpt-live-1"),
  OPENAI_LIVE_VOICE: z.string().default("cedar"),
  LIVE_MAX_SECONDS: z.coerce.number().int().positive().default(300),
  LIVE_MAX_SESSIONS: z.coerce.number().int().positive().default(20),
  CHROMIUM_PATH: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Konfigurasi environment tidak valid: ${fields}`);
  }
  return parsed.data;
}
