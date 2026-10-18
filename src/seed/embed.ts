import { eq, isNull } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { lowongan, personas } from "../db/schema.js";
import { createModels } from "../ai/models.js";
import { embedLowongan } from "../domain/matching.js";

/** Mengisi embedding yang masih kosong, misalnya setelah seed berjalan tanpa kunci API yang valid. */
const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const models = createModels(env);

try {
  const kosong = await db.select({ id: lowongan.id }).from(lowongan).where(isNull(lowongan.embedding));
  for (let start = 0; start < kosong.length; start += 25) {
    await embedLowongan(db, models, kosong.slice(start, start + 25).map((row) => row.id));
  }
  const personaKosong = await db.select().from(personas).where(isNull(personas.embedding));
  for (const persona of personaKosong) {
    const embedding = await models.embed(`${persona.title}. ${persona.summary}. Keahlian: ${persona.skills.join(", ")}`);
    await db.update(personas).set({ embedding }).where(eq(personas.id, persona.id));
  }
  const sisa = await db.select({ id: lowongan.id }).from(lowongan).where(isNull(lowongan.embedding));
  console.log(`Embedding: ${kosong.length - sisa.length} Lowongan dan ${personaKosong.length} Persona diisi; ${sisa.length} Lowongan masih kosong.`);
} finally {
  await pool.end();
}
