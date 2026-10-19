import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string, onGalat?: (error: Error) => void) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  // Neon closes idle connections (and suspends compute when idle). Without this listener the
  // pool re-emits that as an unhandled 'error' event and the whole process exits. The pool drops
  // the broken client by itself and opens a new one on the next query.
  pool.on("error", (error) => onGalat?.(error));
  const db = drizzle(pool, { schema });
  return { db, pool };
}
