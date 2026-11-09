import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { badRequest, forbidden, notFound, unprocessable } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { INBOUND_EVENT_TYPES, OUTBOUND_EVENT_TYPES } from "@/lib/integration/events";
import { processOutbox, resetForRedelivery, type DispatchSummary } from "@/lib/integration/dispatcher";
import { assertSafeDestination, type ConnectionRow } from "@/lib/integration/connectors";
import { INTEGRATION_AUTH_TYPES, validAuthHeaderName } from "@/lib/integration/auth";
import { ENV_NAME_RE, envVarIsSet, liveRuntimeEnabled } from "@/lib/integration/sanitize";
import { db, isUuid, withTx } from "./common";

/**
 * UNIKLIFE.AI integration management (INTERNAL). Everything about the remote side is a
 * PROPOSAL until UNIKLIFE.AI's real API is documented and verified.
 */

export type EffectiveMode = "mock" | "live" | "live_disabled";

export interface ConnectionView extends ConnectionRow {
  effective_mode: EffectiveMode;
  live_runtime_enabled: boolean;
  env_status: { outbound_secret_env: boolean; inbound_secret_env: boolean };
  inbound_url: string;
}

export function inboundWebhookUrl(): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/uniklife/incoming`;
}

function view(c: ConnectionRow): ConnectionView {
  const live = liveRuntimeEnabled();
  return {
    ...c,
    effective_mode: c.mode === "live" ? (live && c.live_verified ? "live" : "live_disabled") : "mock",
    live_runtime_enabled: live,
    env_status: { outbound_secret_env: envVarIsSet(c.outbound_secret_env), inbound_secret_env: envVarIsSet(c.inbound_secret_env) },
    inbound_url: inboundWebhookUrl(),
  };
}

export async function getConnection(ctx: AuthContext): Promise<ConnectionView | null> {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  const [c] = await q.query<ConnectionRow>("select * from integration_connections where organization_id = $1 and provider = 'uniklife' order by created_at limit 1", [ctx.organizationId]);
  return c ? view(c) : null;
}

export async function getConnections(ctx: AuthContext): Promise<ConnectionView[]> {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  const rows = await q.query<ConnectionRow>(
    "select * from integration_connections where organization_id = $1 and provider = 'uniklife' order by created_at, id",
    [ctx.organizationId],
  );
  return rows.map(view);
}

const envName = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || ENV_NAME_RE.test(v), "Use an environment variable NAME like UNIKLIFE_OUTBOUND_SECRET (A-Z, 0-9, _)");

const mappedName = z.string().trim().max(100).regex(/^[A-Za-z0-9_.:-]*$/, "Letters, digits, _ . : - only");

export const connectionUpdateSchema = z.object({
  connection_id: z.string().uuid().optional(),
  connection_type: z.enum(["api", "webhook", "both"]).default("both"),
  name: z.string().trim().min(2).max(80),
  is_enabled: z.boolean(),
  destination_url: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  auth_type: z.enum(INTEGRATION_AUTH_TYPES),
  inbound_auth_type: z.enum(INTEGRATION_AUTH_TYPES).default("hmac"),
  outbound_auth_header_name: z.string().trim().default("X-API-Key").refine(validAuthHeaderName, "Enter a valid HTTP header name"),
  inbound_auth_header_name: z.string().trim().default("X-API-Key").refine(validAuthHeaderName, "Enter a valid HTTP header name"),
  outbound_secret_env: envName,
  inbound_secret_env: envName,
  event_mappings: z.record(z.union([mappedName, z.number().int().min(0).max(20)])).default({}),
});
export type ConnectionUpdate = z.input<typeof connectionUpdateSchema>;

function validateMappings(m: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === "__mock_fail_next") {
      if (typeof v !== "number") throw badRequest("__mock_fail_next must be a number");
      if (v > 0) out[k] = v;
    } else if (k === "__response_reference_field") {
      if (typeof v !== "string" || !/^[A-Za-z0-9_]{0,64}$/.test(v)) throw badRequest("__response_reference_field must be a top-level JSON key");
      if (v) out[k] = v;
    } else if ((OUTBOUND_EVENT_TYPES as readonly string[]).includes(k)) {
      if (typeof v !== "string") throw badRequest(`Mapping for ${k} must be a string`);
      if (v) out[k] = v;
    } else {
      throw badRequest(`Unknown event type in mappings: ${k}`);
    }
  }
  return out;
}

/** Create/update the organization's connection. Mode changes go through verifyLive(). */
export async function updateConnection(ctx: AuthContext, input: ConnectionUpdate, createNew = false): Promise<ConnectionView> {
  assertPermission(ctx, "integration.manage");
  const d = connectionUpdateSchema.parse(input);
  if (d.destination_url) assertSafeDestination(d.destination_url);
  const mappings = validateMappings(d.event_mappings);
  return withTx(async (q) => {
    const [before] = createNew
      ? []
      : await q.query<ConnectionRow>(
          d.connection_id
            ? "select * from integration_connections where organization_id = $1 and provider = 'uniklife' and id = $2 for update"
            : "select * from integration_connections where organization_id = $1 and provider = 'uniklife' order by created_at limit 1 for update",
          d.connection_id ? [ctx.organizationId, d.connection_id] : [ctx.organizationId],
        );
    if (d.connection_id && !before) throw notFound("Integration connection");
    let row: ConnectionRow;
    if (!before) {
      [row] = await q.query<ConnectionRow>(
        `insert into integration_connections
           (organization_id, provider, connection_type, name, mode, is_enabled, destination_url, auth_type, inbound_auth_type,
            outbound_auth_header_name, inbound_auth_header_name, outbound_secret_env, inbound_secret_env, event_mappings)
         values ($1, 'uniklife', $2, $3, 'mock', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) returning *`,
        [ctx.organizationId, d.connection_type, d.name, d.is_enabled, d.destination_url, d.auth_type, d.inbound_auth_type,
          d.outbound_auth_header_name, d.inbound_auth_header_name, d.outbound_secret_env, d.inbound_secret_env, mappings],
      );
    } else {
      // Changing where/how we send invalidates a previous live verification.
      const deliveryChanged =
        before.destination_url !== d.destination_url || before.auth_type !== d.auth_type ||
        before.outbound_secret_env !== d.outbound_secret_env || before.outbound_auth_header_name !== d.outbound_auth_header_name;
      const resetLive = before.mode === "live" && deliveryChanged;
      [row] = await q.query<ConnectionRow>(
        `update integration_connections set connection_type = $2, name = $3, is_enabled = $4, destination_url = $5,
                auth_type = $6, inbound_auth_type = $7, outbound_auth_header_name = $8, inbound_auth_header_name = $9,
                outbound_secret_env = $10, inbound_secret_env = $11, event_mappings = $12::jsonb,
                mode = case when $13 then 'mock' else mode end,
                live_verified = case when $13 then false else live_verified end,
                live_verified_by = case when $13 then null else live_verified_by end,
                live_verified_at = case when $13 then null else live_verified_at end
          where id = $1 returning *`,
        [before.id, d.connection_type, d.name, d.is_enabled, d.destination_url, d.auth_type, d.inbound_auth_type,
          d.outbound_auth_header_name, d.inbound_auth_header_name, d.outbound_secret_env, d.inbound_secret_env, mappings, resetLive],
      );
    }
    const pick = (c: ConnectionRow | undefined) =>
      c && { name: c.name, mode: c.mode, is_enabled: c.is_enabled, destination_url: c.destination_url, auth_type: c.auth_type,
             outbound_secret_env: c.outbound_secret_env, inbound_secret_env: c.inbound_secret_env, event_mappings: c.event_mappings };
    await writeAudit(q, ctx, {
      action: before ? "integration.updated" : "integration.created", entityType: "integration_connection", entityId: row.id,
      summary: before && before.mode === "live" && row.mode === "mock" ? "Delivery settings changed — live verification reset to MOCK" : "UNIKLIFE.AI connection settings saved",
      before: pick(before), after: pick(row),
    });
    return view(row);
  });
}

export const verifyLiveSchema = z.object({
  enable: z.boolean(),
  connection_id: z.string().uuid().optional(),
  /** The admin must type this phrase to confirm the real interface was verified. */
  confirmation: z.string().optional(),
});
export const LIVE_CONFIRMATION_PHRASE = "I VERIFIED THE UNIKLIFE.AI API";

/**
 * Switch to LIVE (org admin only) after the real UNIKLIFE.AI endpoint, payload format and
 * auth have been verified, or back to MOCK. Even when live, nothing is sent unless
 * UNIKLIFE_LIVE_ENABLED=true at runtime.
 */
export async function verifyLive(ctx: AuthContext, input: z.input<typeof verifyLiveSchema>): Promise<ConnectionView> {
  assertPermission(ctx, "integration.manage");
  if (ctx.role !== "org_admin" && ctx.role !== "platform_admin") throw forbidden("Only an organization administrator can switch the connection to live");
  const d = verifyLiveSchema.parse(input);
  return withTx(async (q) => {
    const [c] = await q.query<ConnectionRow>(
      d.connection_id
        ? "select * from integration_connections where organization_id = $1 and provider = 'uniklife' and id = $2 for update"
        : "select * from integration_connections where organization_id = $1 and provider = 'uniklife' order by created_at limit 1 for update",
      d.connection_id ? [ctx.organizationId, d.connection_id] : [ctx.organizationId],
    );
    if (!c) throw notFound("UNIKLIFE.AI connection");
    let row: ConnectionRow;
    if (d.enable) {
      if (d.confirmation?.trim() !== LIVE_CONFIRMATION_PHRASE) throw badRequest(`Type "${LIVE_CONFIRMATION_PHRASE}" to confirm`);
      if (c.connection_type === "webhook") throw unprocessable("This connection only receives webhooks and has no API destination");
      if (!c.destination_url) throw unprocessable("Set a verified https destination URL first");
      assertSafeDestination(c.destination_url);
      if (!c.outbound_secret_env || !envVarIsSet(c.outbound_secret_env)) throw unprocessable("The outbound secret environment variable must be set on the server first");
      [row] = await q.query<ConnectionRow>(
        "update integration_connections set mode = 'live', live_verified = true, live_verified_by = $2, live_verified_at = now() where id = $1 returning *",
        [c.id, ctx.user.id],
      );
    } else {
      [row] = await q.query<ConnectionRow>(
        "update integration_connections set mode = 'mock', live_verified = false, live_verified_by = null, live_verified_at = null where id = $1 returning *",
        [c.id],
      );
    }
    await writeAudit(q, ctx, {
      action: d.enable ? "integration.live_verified" : "integration.switched_to_mock", entityType: "integration_connection", entityId: c.id,
      summary: d.enable ? `Live mode verified by ${ctx.user.fullName}${liveRuntimeEnabled() ? "" : " (UNIKLIFE_LIVE_ENABLED is off — still not sending)"}` : "Switched back to MOCK",
    });
    return view(row);
  });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
const OUTBOUND_STATUSES = ["pending", "delivered", "failed", "dead_letter", "skipped"] as const;

export async function listOutbound(ctx: AuthContext, f: { status?: string; type?: string; limit?: number } = {}) {
  assertPermission(ctx, "integration.manage");
  const params: unknown[] = [ctx.organizationId];
  const where = ["e.organization_id = $1"];
  if (f.status && (OUTBOUND_STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`e.status = $${params.length}`);
  }
  if (f.type && (OUTBOUND_EVENT_TYPES as readonly string[]).includes(f.type)) {
    params.push(f.type);
    where.push(`e.event_type = $${params.length}`);
  }
  params.push(Math.min(Math.max(f.limit ?? 100, 1), 500));
  const q = await db();
  return q.query<{
    id: string; organization_id: string; organization_name: string; event_type: string; aggregate_type: string; aggregate_id: string | null;
    status: string; attempts: number; max_attempts: number; next_attempt_at: Date; last_attempt_at: Date | null; last_error: string | null;
    last_response_status: number | null; last_response_excerpt: string | null; external_reference: string | null; idempotency_key: string;
    caused_by_webhook_event_id: string | null; delivered_at: Date | null; created_at: Date; connection_name: string | null; connection_mode: string | null;
    attempts_log: { attempt_no: number; success: boolean; response_status: number | null; error: string | null; duration_ms: number | null; connector_mode: string; created_at: string }[];
  }>(
    `select e.id, e.organization_id, o.name as organization_name, e.event_type, e.aggregate_type, e.aggregate_id, e.status, e.attempts, e.max_attempts,
            e.next_attempt_at, e.last_attempt_at, e.last_error, e.last_response_status, e.last_response_excerpt, e.external_reference, e.idempotency_key,
            e.caused_by_webhook_event_id, e.delivered_at, e.created_at, c.name as connection_name, c.mode as connection_mode,
            coalesce((select json_agg(json_build_object('attempt_no', a.attempt_no, 'success', a.success, 'response_status', a.response_status,
                       'error', a.error, 'duration_ms', a.duration_ms, 'connector_mode', a.connector_mode, 'created_at', a.created_at) order by a.created_at)
                        from outbound_delivery_attempts a where a.outbound_event_id = e.id), '[]'::json) as attempts_log
       from outbound_events e
       join organizations o on o.id = e.organization_id
       left join integration_connections c on c.id = e.connection_id
      where ${where.join(" and ")}
      order by e.created_at desc limit $${params.length}`,
    params,
  );
}

export async function getOutbound(ctx: AuthContext, id: string) {
  assertPermission(ctx, "integration.manage");
  if (!isUuid(id)) throw notFound("Outbound event");
  const q = await db();
  const [e] = await q.query<Record<string, unknown>>(
    `select e.*, c.name as connection_name, c.mode as connection_mode from outbound_events e
       left join integration_connections c on c.id = e.connection_id where e.organization_id = $1 and e.id = $2`,
    [ctx.organizationId, id],
  );
  if (!e) throw notFound("Outbound event");
  const attempts = await q.query<Record<string, unknown>>(
    "select attempt_no, success, response_status, error, duration_ms, connector_mode, created_at from outbound_delivery_attempts where outbound_event_id = $1 order by created_at",
    [id],
  );
  return { event: e, attempts };
}

export async function listWebhookEvents(ctx: AuthContext, f: { status?: string; limit?: number } = {}) {
  assertPermission(ctx, "integration.manage");
  const params: unknown[] = [ctx.organizationId];
  let where = "w.organization_id = $1 and w.source = 'uniklife'";
  if (f.status && ["received", "queued", "processed", "rejected", "failed", "ignored"].includes(f.status)) {
    params.push(f.status);
    where += ` and w.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(f.limit ?? 100, 1), 500));
  const q = await db();
  return q.query<{
    id: string; external_event_id: string; event_type: string; status: string; error: string | null; signature_valid: boolean; attempts: number;
    duplicate_count: number; received_at: Date; processed_at: Date | null; payload: unknown;
  }>(
    `select w.id, w.external_event_id, w.event_type, w.status, w.error, w.signature_valid, w.attempts, w.duplicate_count, w.received_at, w.processed_at, w.payload
       from webhook_events w where ${where} order by w.received_at desc limit $${params.length}`,
    params,
  );
}

export async function listMockRecords(ctx: AuthContext, limit = 100) {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  return q.query<{ id: string; idempotency_key: string; event_type: string; payload: Record<string, unknown>; received_at: Date }>(
    "select id, idempotency_key, event_type, payload, received_at from mock_uniklife_records where organization_id = $1 order by received_at desc limit $2",
    [ctx.organizationId, Math.min(Math.max(limit, 1), 500)],
  );
}

export async function integrationStats(ctx: AuthContext) {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  const [s] = await q.query<Record<string, number>>(
    `select count(*) filter (where status = 'delivered')::int as delivered,
            count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where status = 'dead_letter')::int as dead_letter,
            count(*) filter (where status = 'skipped')::int as skipped,
            count(*)::int as total
       from outbound_events where organization_id = $1 and created_at >= now() - interval '24 hours'`,
    [ctx.organizationId],
  );
  const [w] = await q.query<Record<string, number>>(
    `select count(*)::int as inbound, count(*) filter (where status in ('rejected', 'failed'))::int as inbound_problems
       from webhook_events where organization_id = $1 and source = 'uniklife' and received_at >= now() - interval '24 hours'`,
    [ctx.organizationId],
  );
  return { ...s, ...w, window: "24h" } as {
    delivered: number; pending: number; failed: number; dead_letter: number; skipped: number; total: number; inbound: number; inbound_problems: number; window: string;
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export async function redeliverOutbound(ctx: AuthContext, id: string, kind: "retry" | "replay") {
  assertPermission(ctx, "integration.manage");
  if (!isUuid(id)) throw notFound("Outbound event");
  await withTx(async (q) => {
    const ev = await resetForRedelivery(q, ctx.organizationId, id, kind);
    await writeAudit(q, ctx, {
      action: `integration.outbound_${kind}`, entityType: "outbound_event", entityId: id,
      summary: `${kind === "retry" ? "Manual retry" : "Replay (same idempotency key)"} of ${ev.event_type}`, metadata: { previous_status: ev.status },
    });
  });
  const summary = await processOutbox({ organizationId: ctx.organizationId, eventIds: [id], limit: 1 });
  return summarize(summary);
}

function summarize(s: DispatchSummary) {
  return { claimed: s.claimed, delivered: s.delivered, failed: s.failed, deadLettered: s.deadLettered, results: s.results };
}

/** INTERNAL dispatch trigger ("Dispatch now"). This is NOT a UNIKLIFE.AI endpoint. */
const connectionActionSchema = z.object({ connection_id: z.string().uuid().optional() });

export async function syncNow(ctx: AuthContext, input: z.input<typeof connectionActionSchema> = {}) {
  assertPermission(ctx, "integration.manage");
  const d = connectionActionSchema.parse(input);
  if (d.connection_id) {
    const q = await db();
    const [connection] = await q.query<{ id: string }>(
      "select id from integration_connections where id = $1 and organization_id = $2 and provider = 'uniklife'",
      [d.connection_id, ctx.organizationId],
    );
    if (!connection) throw notFound("Integration connection");
  }
  const s = await processOutbox({ organizationId: ctx.organizationId, connectionId: d.connection_id, limit: 100 });
  const q = await db();
  await writeAudit(q, ctx, { action: "integration.dispatch_now", entityType: "integration_connection", summary: `Dispatched ${s.claimed} event(s): ${s.delivered} delivered, ${s.failed} failed, ${s.deadLettered} dead-lettered` });
  return summarize(s);
}

/** Enqueues and dispatches an 'integration.test' event with SAFE SAMPLE DATA (no customer data). */
export async function sendTestEvent(ctx: AuthContext, input: z.input<typeof connectionActionSchema> = {}) {
  assertPermission(ctx, "integration.manage");
  const d = connectionActionSchema.parse(input);
  const id = randomUUID();
  const idempotencyKey = `integration.test:${id}`;
  await withTx(async (q) => {
    const [conn] = await q.query<{ id: string }>(
      d.connection_id
        ? "select id from integration_connections where organization_id = $1 and provider = 'uniklife' and id = $2 and is_enabled = true and connection_type in ('api', 'both')"
        : "select id from integration_connections where organization_id = $1 and provider = 'uniklife' and is_enabled = true and connection_type in ('api', 'both') order by created_at limit 1",
      d.connection_id ? [ctx.organizationId, d.connection_id] : [ctx.organizationId],
    );
    if (!conn) throw unprocessable("Enable the UNIKLIFE.AI connection first");
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "integration.test", aggregateType: "integration", aggregateId: null, idempotencyKey,
      data: {
        test: true,
        message: "Connectivity test from UNIKLIFE 3D Venture. Sample data only — contains no customer information.",
        sample: { plot_number: "TEST-001", venture_code: "SAMPLE", amount: 0, currency: "INR" },
        requested_at: new Date().toISOString(),
      },
      connectionId: conn.id,
    });
    await writeAudit(q, ctx, { action: "integration.test_event", entityType: "integration_connection", entityId: conn.id, summary: "Test event queued" });
  });
  const q = await db();
  const [ev] = await q.query<{ id: string }>("select id from outbound_events where idempotency_key = $1", [idempotencyKey]);
  const s = await processOutbox({ organizationId: ctx.organizationId, connectionId: d.connection_id, eventIds: [ev.id], limit: 1 });
  return { eventId: ev.id, ...summarize(s) };
}

export const INTEGRATION_CATALOGUE = { outbound: OUTBOUND_EVENT_TYPES, inbound: INBOUND_EVENT_TYPES };
