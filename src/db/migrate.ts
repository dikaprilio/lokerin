import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum diisi");

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await pool.query("create extension if not exists vector");
  await migrate(drizzle(pool), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  console.log("Migrasi selesai");
} finally {
  await pool.end();
}
