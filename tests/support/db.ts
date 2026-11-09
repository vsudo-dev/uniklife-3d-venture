import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seedDemo } from "@/lib/db/seed";
import { setDbForTesting } from "@/lib/db";
import type { Database } from "@/lib/db/types";
import { loadAuthContext, type AuthContext } from "@/lib/auth/context";

/**
 * Fresh in-memory PostgreSQL (PGlite) with all migrations and the demo seed.
 * Each test file gets its own disposable database.
 */
export async function createTestDb(opts: { seed?: boolean } = {}): Promise<Database> {
  const db = await createPgliteDatabase();
  await migrate(db);
  if (opts.seed !== false) await seedDemo(db);
  setDbForTesting(db);
  return db;
}

/** Builds the same AuthContext the app builds for a signed-in user (by email). */
export async function ctxFor(db: Database, email: string, orgId?: string): Promise<AuthContext> {
  const [u] = await db.query<{ id: string }>("select id from app_users where lower(email) = lower($1)", [email]);
  if (!u) throw new Error(`No user ${email}`);
  return loadAuthContext(db, u.id, orgId ?? null);
}

export async function demoVenture(db: Database) {
  const [v] = await db.query<{ id: string; organization_id: string }>("select id, organization_id from ventures where code = 'SUNRISE-DEMO'");
  return v;
}

export async function plotIds(db: Database, ventureId: string, numbers: string[]): Promise<string[]> {
  const rows = await db.query<{ id: string; plot_number: string }>(
    "select id, plot_number from plots where venture_id = $1 and plot_number = any($2::text[])",
    [ventureId, numbers],
  );
  return numbers.map((n) => rows.find((r) => r.plot_number === n)!.id);
}

let n = 0;
export const key = (p = "t") => `${p}-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
