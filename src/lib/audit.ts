import type { Queryable } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export type AuditActor =
  | AuthContext
  | { system: true; organizationId: string | null; actorType?: "system" | "webhook" };

const SENSITIVE = /password|secret|token|key|hash/i;

/** Strips anything credential-like before it reaches the audit log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) && k !== "idempotency_key" ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export async function writeAudit(q: Queryable, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const isSystem = "system" in actor;
  await q.query(
    `insert into audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, summary, before_data, after_data, metadata, ip_address)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
    [
      actor.organizationId,
      isSystem ? null : actor.user.id,
      isSystem ? (actor.actorType ?? "system") : "user",
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary ?? null,
      entry.before === undefined ? null : redact(entry.before),
      entry.after === undefined ? null : redact(entry.after),
      redact(entry.metadata ?? {}),
      isSystem ? null : (actor.ip ?? null),
    ],
  );
}
