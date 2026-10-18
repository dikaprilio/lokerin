import type { Mastra } from "@mastra/core/mastra";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import type { EventBus } from "./events/bus.js";
import type { Models } from "./ai/models.js";
import type pg from "pg";

export type AppContext = {
  env: Env;
  db: Db;
  pool: pg.Pool;
  models: Models;
  bus: EventBus;
  mastra: Mastra;
};
