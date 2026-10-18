import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
