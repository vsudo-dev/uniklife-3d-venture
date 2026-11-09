export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Multi-statement script without parameters (simple protocol); used for migrations. */
  execScript?(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  readonly driver: "pglite" | "postgres";
  /** Runs fn inside a single transaction (BEGIN/COMMIT, ROLLBACK on throw). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Executes a multi-statement SQL script without parameters (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Postgres error with SQLSTATE code (both drivers expose `code`). */
export interface PgError extends Error {
  code?: string;
  constraint?: string;
  constraint_name?: string;
}

export function isPgError(e: unknown, code?: string): e is PgError {
  return typeof e === "object" && e !== null && "code" in e && (code ? (e as PgError).code === code : true);
}

export function constraintName(e: unknown): string | undefined {
  if (!isPgError(e)) return undefined;
  const fromField = e.constraint ?? e.constraint_name;
  if (fromField) return fromField;
  const m = /constraint "([^"]+)"/.exec(e.message ?? "");
  return m?.[1];
}

/** numeric/bigint columns arrive as strings from some drivers — normalize. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

/** Serializes params identically for both drivers. */
export function serializeParam(p: unknown, arrayLiteral: boolean): unknown {
  if (p === undefined) return null;
  if (p === null || p instanceof Date) return p;
  if (Array.isArray(p)) {
    if (!arrayLiteral) return p;
    return "{" + p.map((x) => (x === null ? "NULL" : '"' + String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')).join(",") + "}";
  }
  if (typeof p === "object") return JSON.stringify(p);
  return p;
}
