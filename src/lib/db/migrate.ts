import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<{ name: string; sql: string }[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), "utf8") })));
}

/** Applies pending migrations in order; each migration runs in its own transaction. */
export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`create table if not exists public._app_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await db.query<{ name: string }>("select name from public._app_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const m of await listMigrations(dir)) {
    if (applied.has(m.name)) continue;
    // Each migration runs atomically through the driver's own transaction API
    // (raw BEGIN/COMMIT is not allowed on pooled postgres.js connections).
    await db
      .transaction(async (tx) => {
        if (!tx.execScript) throw new Error("Driver cannot execute migration scripts");
        await tx.execScript(m.sql);
        await tx.query("insert into public._app_migrations(name) values ($1)", [m.name]);
      })
      .catch((e) => {
        throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
      });
    ran.push(m.name);
  }
  return ran;
}
