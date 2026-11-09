import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";
import { secretFromEnvName } from "@/lib/env";
import { conflict, notFound } from "@/lib/errors";
import { EVENT_SOURCE, OUTBOUND_EVENT_TYPES, type EventEnvelope, type OutboundEventType } from "./events";
import { computeRetryDelay } from "./backoff";
import { connectorFor, isOptionKey, type ConnectionRow, type SendResult, type UniklifeConnector } from "./connectors";
import { EXCERPT_MAX, sanitizeText } from "./sanitize";

/**
 * Outbound dispatcher for the transactional outbox (outbound_events).
 *
 * 1. CLAIM (short transaction): due rows (status pending/failed, next_attempt_at <= now)
 *    are selected FOR UPDATE SKIP LOCKED and leased by pushing next_attempt_at forward,
 *    so concurrent workers never pick the same row and nothing is held locked during I/O.
 * 2. SEND (no transaction): build the envelope, apply event_mappings, call the connector.
 * 3. RECORD (short transaction): insert a sanitized outbound_delivery_attempts row and
 *    mark the event delivered, or schedule a retry (exponential backoff + jitter) and
 *    move it to dead_letter after max_attempts.
 */
const LEASE_SECONDS = 300;

export interface OutboundEventRow {
  id: string;
  organization_id: string;
  connection_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: Date | string;
}

export interface DispatchResult {
  id: string;
  eventType: string;
  status: "delivered" | "failed" | "dead_letter";
  attempt: number;
  externalReference?: string | null;
  error?: string | null;
  nextAttemptAt?: string | null;
}

export interface DispatchSummary {
  claimed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  results: DispatchResult[];
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function addCrmParameterCodes(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const data = { ...payload };
  const customer = typeof payload.customer === "object" && payload.customer !== null
    ? payload.customer as Record<string, unknown>
    : {};
  const plots = Array.isArray(payload.plots) ? payload.plots as Record<string, unknown>[] : [];
  const firstPlot = plots[0];
  const aliases: Record<string, unknown> = {
    customer_name: customer.name ?? (eventType === "plot.enquiry.created" ? payload.name : undefined),
    customer_phone: customer.phone ?? payload.phone,
    customer_email: customer.email ?? payload.email,
    customer_id: customer.id ?? payload.customer_id,
    project_name: payload.venture_name,
    project_id: payload.venture_id,
    booking_status: payload.payment_status ?? (eventType.startsWith("plot.booking.") ? payload.status : undefined),
    plot_numbers: payload.plot_numbers ?? (plots.length ? plots.map((plot) => plot.plot_number).filter((n) => typeof n === "string") : undefined),
    plot_number: payload.plot_number ?? (plots.length === 1 ? firstPlot?.plot_number : undefined),
    plot_area_sq_yards: firstPlot?.area_sq_yards,
    discount_name: eventType === "discount.applied" ? payload.name : undefined,
    discount_code: eventType === "discount.applied" ? payload.code : undefined,
    discount_amount: eventType === "discount.applied" ? payload.amount : payload.discount_amount,
    payment_amount: eventType === "payment.verified" ? payload.amount : undefined,
    payment_provider: eventType === "payment.verified" ? payload.provider : undefined,
    payment_method: eventType === "payment.verified" ? payload.method : undefined,
    payment_reference: payload.payment_reference ?? payload.provider_reference,
    employee_id: eventType.startsWith("employee.") ? payload.employee_id : undefined,
    employee_name: eventType.startsWith("employee.") ? payload.full_name : undefined,
    selling_employee_code: payload.selling_employee_code ?? payload.credited_employee_code,
    commission_total_amount: eventType.startsWith("commission.") ? payload.total_amount : undefined,
    commission_basis: eventType === "commission.calculated" ? payload.basis : undefined,
    commission_entries: payload.entries,
    payees: payload.payees,
    settlement_reference: payload.reference,
  };
  for (const [code, value] of Object.entries(aliases)) {
    if (value !== undefined) data[code] = value;
  }
  return data;
}

/** Applies event_mappings: internal type → mapped (destination) type, when configured. */
export function buildEnvelope(ev: OutboundEventRow, connection: ConnectionRow | null): EventEnvelope {
  const mappings = connection?.event_mappings ?? {};
  const mapped = mappings[ev.event_type];
  const payload = ev.payload ?? {};
  const envelope: EventEnvelope = {
    id: ev.id,
    type: ev.event_type as OutboundEventType,
    version: 1,
    source: EVENT_SOURCE,
    occurred_at: iso(ev.created_at),
    organization_id: ev.organization_id,
    source_record_id: ev.aggregate_id,
    idempotency_key: ev.idempotency_key,
    simulated: connection?.mode !== "live" || payload.simulated === true,
    test: payload.test === true || ev.event_type === "integration.test",
    data: addCrmParameterCodes(ev.event_type, payload),
  };
  if (typeof mapped === "string" && mapped.trim() && !isOptionKey(ev.event_type)) envelope.mapped_type = mapped.trim();
  return envelope;
}

async function claimDue(opts: { limit: number; organizationId?: string; eventIds?: string[]; connectionId?: string }): Promise<OutboundEventRow[]> {
  const db = await getDb();
  return db.transaction(async (q) => {
    const params: unknown[] = [opts.limit];
    const where = ["status in ('pending', 'failed')", "next_attempt_at <= now()"];
    if (opts.organizationId) {
      params.push(opts.organizationId);
      where.push(`organization_id = $${params.length}`);
    }
    if (opts.eventIds) {
      params.push(opts.eventIds);
      where.push(`id = any($${params.length}::uuid[])`);
    }
    if (opts.connectionId) {
      params.push(opts.connectionId);
      where.push(`connection_id = $${params.length}`);
    }
    const rows = await q.query<OutboundEventRow>(
      `select id, organization_id, connection_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, status, attempts, max_attempts, created_at
         from outbound_events where ${where.join(" and ")}
        order by next_attempt_at, created_at limit $1 for update skip locked`,
      params,
    );
    if (rows.length > 0) {
      await q.query(`update outbound_events set next_attempt_at = now() + make_interval(secs => $2) where id = any($1::uuid[])`, [
        rows.map((r) => r.id),
        LEASE_SECONDS,
      ]);
    }
    return rows;
  });
}

async function loadConnection(q: Queryable, ev: OutboundEventRow): Promise<ConnectionRow | null> {
  const rows = ev.connection_id
    ? await q.query<ConnectionRow>("select * from integration_connections where id = $1 and organization_id = $2", [ev.connection_id, ev.organization_id])
    : await q.query<ConnectionRow>("select * from integration_connections where organization_id = $1 and provider = 'uniklife'", [ev.organization_id]);
  return rows[0] ?? null;
}

export interface ProcessOutboxOptions {
  limit?: number;
  organizationId?: string;
  connectionId?: string;
  /** Restrict to specific events (e.g. "send test event"). */
  eventIds?: string[];
  /** Test seam: force a connector. */
  connector?: UniklifeConnector;
  random?: () => number;
}

export async function processOutbox(opts: ProcessOutboxOptions = {}): Promise<DispatchSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const claimed = await claimDue({ limit, organizationId: opts.organizationId, eventIds: opts.eventIds, connectionId: opts.connectionId });
  const summary: DispatchSummary = { claimed: claimed.length, delivered: 0, failed: 0, deadLettered: 0, results: [] };
  const db = await getDb();

  for (const ev of claimed) {
    const connection = await loadConnection(db, ev);
    const attemptNo = ev.attempts + 1;
    const started = Date.now();
    let result: SendResult;
    let mode = connection?.mode ?? "none";
    const secrets = [secretFromEnvName(connection?.outbound_secret_env)];

    if (!connection || !connection.is_enabled) {
      result = { ok: false, status: null, error: connection ? "UNIKLIFE.AI connection is disabled" : "No UNIKLIFE.AI connection configured" };
    } else if (!(OUTBOUND_EVENT_TYPES as readonly string[]).includes(ev.event_type)) {
      result = { ok: false, status: null, error: `Unknown internal event type ${ev.event_type}` };
    } else {
      const connector = opts.connector ?? connectorFor(connection);
      mode = connector.mode;
      try {
        result = await connector.send(buildEnvelope(ev, connection), connection);
      } catch (e) {
        result = { ok: false, status: null, error: sanitizeText(e, { secrets }) };
      }
    }
    const duration = Date.now() - started;
    const error = result.ok ? null : sanitizeText(result.error ?? "Delivery failed", { secrets });
    const excerpt = result.excerpt ? sanitizeText(result.excerpt, { secrets, max: EXCERPT_MAX }) : null;
    const externalRef = result.externalReference ? sanitizeText(result.externalReference, { max: 200 }) : null;

    const outcome = await db.transaction(async (q) => {
      await q.query(
        `insert into outbound_delivery_attempts (organization_id, outbound_event_id, attempt_no, success, response_status, error, duration_ms, connector_mode)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ev.organization_id, ev.id, attemptNo, result.ok, result.status, error, duration, mode],
      );
      if (result.ok) {
        await q.query(
          `update outbound_events set status = 'delivered', attempts = $2, last_attempt_at = now(), delivered_at = now(), last_error = null,
                  last_response_status = $3, last_response_excerpt = $4, external_reference = coalesce($5, external_reference),
                  connection_id = coalesce(connection_id, $6)
            where id = $1`,
          [ev.id, attemptNo, result.status, excerpt, externalRef, connection?.id ?? null],
        );
        if (connection) await q.query("update integration_connections set last_success_at = now(), last_error = null where id = $1", [connection.id]);
        return { status: "delivered" as const, next: null };
      }
      const dead = attemptNo >= ev.max_attempts;
      const delayMs = computeRetryDelay(attemptNo, opts.random);
      const [row] = await q.query<{ next_attempt_at: Date }>(
        `update outbound_events set status = $2, attempts = $3, last_attempt_at = now(), last_error = $4, last_response_status = $5,
                last_response_excerpt = $6, next_attempt_at = case when $2 = 'dead_letter' then now() else now() + make_interval(secs => $7::double precision / 1000) end
          where id = $1 returning next_attempt_at`,
        [ev.id, dead ? "dead_letter" : "failed", attemptNo, error, result.status, excerpt, delayMs],
      );
      if (connection) await q.query("update integration_connections set last_error = $2 where id = $1", [connection.id, error]);
      return { status: dead ? ("dead_letter" as const) : ("failed" as const), next: dead ? null : iso(row.next_attempt_at) };
    });

    if (outcome.status === "delivered") summary.delivered++;
    else if (outcome.status === "dead_letter") summary.deadLettered++;
    else summary.failed++;
    summary.results.push({ id: ev.id, eventType: ev.event_type, status: outcome.status, attempt: attemptNo, externalReference: externalRef, error, nextAttemptAt: outcome.next });
  }
  return summary;
}

/**
 * Manual retry (failed / dead_letter) or replay (delivered) — the SAME idempotency key is
 * re-sent, so a correct receiver (like the mock) de-duplicates it. Loop-suppressed or
 * connection-less 'skipped' events cannot be retried.
 */
export async function resetForRedelivery(q: Queryable, organizationId: string, eventId: string, kind: "retry" | "replay") {
  const [ev] = await q.query<{ id: string; status: string; caused_by_webhook_event_id: string | null; idempotency_key: string; event_type: string }>(
    "select id, status, caused_by_webhook_event_id, idempotency_key, event_type from outbound_events where organization_id = $1 and id = $2 for update",
    [organizationId, eventId],
  );
  if (!ev) throw notFound("Outbound event");
  if (ev.caused_by_webhook_event_id) throw conflict("This event was caused by an inbound UNIKLIFE.AI webhook and is never sent back (loop prevention)");
  const allowed = kind === "retry" ? ["failed", "dead_letter"] : ["delivered", "failed", "dead_letter"];
  if (!allowed.includes(ev.status)) throw conflict(`Cannot ${kind} an event that is ${ev.status}`);
  const [conn] = await q.query<{ id: string }>(
    "select id from integration_connections where organization_id = $1 and provider = 'uniklife' and is_enabled = true",
    [organizationId],
  );
  if (!conn) throw conflict("Enable the UNIKLIFE.AI connection first");
  await q.query(
    `update outbound_events set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null,
            connection_id = coalesce(connection_id, $2) where id = $1`,
    [eventId, conn.id],
  );
  return ev;
}
