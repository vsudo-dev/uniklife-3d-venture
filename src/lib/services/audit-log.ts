import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { toCsv } from "@/lib/csv";
import { db, isUuid } from "./common";

// ---------------------------------------------------------------------------
// Audit log viewer (audit.view). Always scoped to the caller's organization.
// before/after data is redacted at write time (see src/lib/audit.ts).
// ---------------------------------------------------------------------------

export const auditFilterSchema = z.object({
  action: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  entityType: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
  actorId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type AuditFilters = z.input<typeof auditFilterSchema>;

export interface AuditRow {
  id: string;
  created_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before_data: unknown;
  after_data: unknown;
  metadata: unknown;
  ip_address: string | null;
}

function buildWhere(ctx: AuthContext, f: z.output<typeof auditFilterSchema>) {
  const params: unknown[] = [ctx.organizationId];
  const where = ["a.organization_id = $1"];
  if (f.action) {
    params.push(`%${f.action.toLowerCase()}%`);
    where.push(`lower(a.action) like $${params.length}`);
  }
  if (f.entityType) {
    params.push(f.entityType);
    where.push(`a.entity_type = $${params.length}`);
  }
  if (f.actorId && isUuid(f.actorId)) {
    params.push(f.actorId);
    where.push(`a.actor_user_id = $${params.length}`);
  }
  // Dates are interpreted in India Standard Time (the organization's business timezone).
  if (f.from) {
    params.push(f.from);
    where.push(`a.created_at >= ($${params.length}::date::timestamp at time zone 'Asia/Kolkata')`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`a.created_at < (($${params.length}::date + 1)::timestamp at time zone 'Asia/Kolkata')`);
  }
  return { params, where: where.join(" and ") };
}

const SELECT = `select a.id, a.created_at, a.actor_user_id, u.full_name as actor_name, u.email as actor_email, a.actor_type, a.action,
                       a.entity_type, a.entity_id, a.summary, a.before_data, a.after_data, a.metadata, a.ip_address
                  from audit_logs a left join app_users u on u.id = a.actor_user_id`;

export async function listAuditLogs(ctx: AuthContext, raw: AuditFilters | Record<string, unknown> = {}) {
  assertPermission(ctx, "audit.view");
  const f = auditFilterSchema.parse(raw);
  const q = await db();
  const { params, where } = buildWhere(ctx, f);
  const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from audit_logs a where ${where}`, params);
  const rows = await q.query<AuditRow>(
    `${SELECT} where ${where} order by a.created_at desc, a.id desc limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
    params,
  );
  return { rows, total: n, page: f.page, pageSize: f.pageSize, pages: Math.max(1, Math.ceil(n / f.pageSize)) };
}

/** Distinct values for the filter dropdowns (scoped to the organization). */
export async function auditFilterOptions(ctx: AuthContext) {
  assertPermission(ctx, "audit.view");
  const q = await db();
  const [entityTypes, actors] = await Promise.all([
    q.query<{ entity_type: string }>("select distinct entity_type from audit_logs where organization_id = $1 order by entity_type", [ctx.organizationId]),
    q.query<{ id: string; full_name: string; email: string }>(
      `select distinct u.id, u.full_name, u.email from audit_logs a join app_users u on u.id = a.actor_user_id
        where a.organization_id = $1 order by u.full_name limit 500`,
      [ctx.organizationId],
    ),
  ]);
  return { entityTypes: entityTypes.map((e) => e.entity_type), actors };
}

const CSV_MAX_ROWS = 10000;

export async function exportAuditCsv(ctx: AuthContext, raw: AuditFilters | Record<string, unknown> = {}): Promise<{ csv: string; truncated: boolean }> {
  assertPermission(ctx, "audit.view");
  const f = auditFilterSchema.parse({ ...raw, page: 1, pageSize: 10 });
  const q = await db();
  const { params, where } = buildWhere(ctx, f);
  const rows = await q.query<AuditRow>(`${SELECT} where ${where} order by a.created_at desc, a.id desc limit ${CSV_MAX_ROWS + 1}`, params);
  const truncated = rows.length > CSV_MAX_ROWS;
  const out = rows.slice(0, CSV_MAX_ROWS).map((r) => ({
    created_at: new Date(r.created_at).toISOString(),
    actor: r.actor_email ?? r.actor_type,
    actor_name: r.actor_name ?? "",
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id ?? "",
    summary: r.summary ?? "",
    ip_address: r.ip_address ?? "",
    before: r.before_data == null ? "" : JSON.stringify(r.before_data),
    after: r.after_data == null ? "" : JSON.stringify(r.after_data),
    metadata: r.metadata == null ? "" : JSON.stringify(r.metadata),
  }));
  return {
    csv: toCsv(["created_at", "actor", "actor_name", "action", "entity_type", "entity_id", "summary", "ip_address", "before", "after", "metadata"], out),
    truncated,
  };
}
