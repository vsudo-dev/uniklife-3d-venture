import postgres from "postgres";
import type { Database, Queryable } from "./types";
import { serializeParam } from "./types";

/**
 * Supabase / hosted PostgreSQL via postgres.js. Server-side only.
 * Use the Supabase *pooler* connection string on serverless hosts (prepare: false
 * is required for transaction-mode pooling).
 */
/**
 * Supabase / Vercel-integration URLs can carry extra query params (e.g. `supa=…`,
 * `pgbouncer=true`) that Postgres would reject as unknown startup parameters.
 * Keep only what postgres.js understands.
 */
export function sanitizeDatabaseUrl(raw: string): string {
  const u = new URL(raw);
  const keep = new Set(["sslmode", "application_name"]);
  for (const k of [...u.searchParams.keys()]) if (!keep.has(k)) u.searchParams.delete(k);
  return u.toString();
}

export function createPostgresDatabase(rawUrl: string): Database {
  const url = sanitizeDatabaseUrl(rawUrl);
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    // numeric/bigint arrive as strings; services normalize with num().
    types: {
      // json (114) / jsonb (3802): accept objects OR already-serialized JSON text, never
      // double-encode. Matches PGlite's behaviour so both drivers store identical data.
      jsonb: {
        to: 3802,
        from: [114, 3802],
        serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)),
        parse: (x: string) => JSON.parse(x),
      },
    },
  });

  // postgres.js learns each parameter's type from the server and serializes jsonb itself,
  // so plain objects must be passed through untouched (pre-stringifying would double-encode
  // them into JSON *strings*). Arrays still become Postgres array literals.
  const param = (p: unknown) =>
    p !== null && typeof p === "object" && !Array.isArray(p) && !(p instanceof Date) ? p : serializeParam(p, true);

  const wrap = (q: postgres.Sql | postgres.TransactionSql): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await q.unsafe(text, params.map(param) as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async execScript(text: string) {
      await q.unsafe(text).simple();
    },
  });

  const base = wrap(sql);
  return {
    driver: "postgres",
    query: base.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return (await sql.begin(async (tx) => fn(wrap(tx)))) as T;
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
