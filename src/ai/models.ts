import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embed, embedMany } from "ai";
import type { Env } from "../config/env.js";

export type Models = ReturnType<typeof createModels>;

/**
 * DeepSeek V4.1 Flash lewat OpenRouter, dibatasi ke provider yang mendukung alat,
 * structured output, dan zero data retention. Snapshot September menjadi cadangan
 * otomatis lewat `models`. `parallelToolCalls` sengaja tidak dikirim karena tidak
 * ada endpoint yang mendukungnya, dan `require_parameters` akan menyaring semuanya.
 */
export function createModels(env: Env) {
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY, appName: "Lokerin" });
  const openai = env.OPENAI_API_KEY ? createOpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  const providers = Array.from(new Set([...env.OPENROUTER_PROVIDERS, "together", "nebius"]));

  const chat = (effort: "low" | "none" = "low") =>
    openrouter.chat(env.OPENROUTER_MODEL, {
      models: [env.OPENROUTER_FALLBACK_MODEL],
      reasoning: { effort },
      extraBody: {
        provider: { only: providers, require_parameters: true, zdr: true, allow_fallbacks: true },
      },
    });

  // Model embedding yang sama (text-embedding-3-small, 1536 dimensi) bisa lewat OpenRouter atau OpenAI.
  const embeddingModel =
    env.EMBEDDING_PROVIDER === "openai" && openai
      ? openai.embedding(env.OPENAI_EMBEDDING_MODEL)
      : openrouter.textEmbeddingModel(`openai/${env.OPENAI_EMBEDDING_MODEL}`);

  return {
    chat,
    async embed(text: string) {
      const { embedding } = await embed({ model: embeddingModel, value: text.slice(0, 8000) });
      return embedding;
    },
    async embedMany(texts: string[]) {
      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: texts.map((text) => text.slice(0, 8000)),
      });
      return embeddings;
    },
  };
}
