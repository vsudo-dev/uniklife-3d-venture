import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "./types";
import { serializeParam } from "./types";

/**
 * Local disposable PostgreSQL (WASM). Used for development and automated tests only.
 * dataDir undefined => in-memory database.
 */
export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;

  const wrap = (q: Pick<PGlite, "query" | "exec">): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query<T>(sql, params.map((p) => serializeParam(p, false)));
      return res.rows;
    },
    async execScript(sql: string) {
      await q.exec(sql);
    },
  });

  const base = wrap(pg);
  return {
    driver: "pglite",
    query: base.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return pg.transaction(async (tx) => fn(wrap(tx)));
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
}
