import "server-only";
import path from "node:path";
import type { Database } from "./types";
import { createPgliteDatabase } from "./pglite";
import { createPostgresDatabase } from "./postgres";
import { migrate } from "./migrate";
import { env } from "@/lib/env";

type Holder = { promise?: Promise<Database>; override?: Database };
const g = globalThis as unknown as { __uniklifeDb?: Holder };
const holder: Holder = (g.__uniklifeDb ??= {});

async function open(): Promise<Database> {
  if (env.DATABASE_DRIVER === "postgres") {
    // DATABASE_URL, or POSTGRES_URL as provided by Vercel's Supabase integration (pooled, port 6543).
    const url = env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is required when DATABASE_DRIVER=postgres");
    // Hosted databases are migrated explicitly (see docs/DEPLOYMENT.md), never on boot.
    return createPostgresDatabase(url);
  }
  const dir = path.resolve(process.cwd(), env.PGLITE_DATA_DIR);
  const db = await createPgliteDatabase(dir);
  await migrate(db);
  if (env.AUTO_SEED_DEMO) {
    const { seedIfEmpty } = await import("./seed");
    await seedIfEmpty(db);
  }
  return db;
}

export function getDb(): Promise<Database> {
  if (holder.override) return Promise.resolve(holder.override);
  holder.promise ??= open().catch((e) => {
    holder.promise = undefined;
    throw e;
  });
  return holder.promise;
}

/** Test hook: route getDb() to a specific (usually in-memory) database. */
export function setDbForTesting(db: Database | undefined) {
  holder.override = db;
}

export * from "./types";
