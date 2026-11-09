import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";
import { secretFromEnvName } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { verifyIntegrationAuth } from "./auth";
import { recordReconciliation } from "@/lib/services/commissions";
import { EVENT_SOURCE, INBOUND_EVENT_TYPES, type InboundEventType } from "./events";
import { sanitizeText } from "./sanitize";
import type { ConnectionRow } from "./connectors/types";

/**
 * POST /api/webhooks/uniklife/incoming — PROPOSED inbound contract (internal, unverified
 * with UNIKLIFE.AI):
 *   headers: X-Uniklife-Connection: <connection uuid>
 *            X-Uniklife-Signature:  t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *            or Authorization: Bearer <shared secret>
 *   body:    { id, type, occurred_at, data, source? }
 *
 * Safety rules: inbound events may ONLY set CRM reference fields (crm_lead_id + enquiry
 * follow-up status, crm_contact_id, crm_deal_id) on records of the connection's own
 * organization, or submit a finance reconciliation for human review. They never change
 * plot status, prices, booking status, payments or commission payment status.
 */
export const INBOUND_MAX_BYTES = 256 * 1024;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

const envelopeSchema = z.object({
  id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/, "Invalid event id"),
  type: z.string().min(1).max(100),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.record(z.unknown()),
  source: z.string().max(100).optional(),
});

const crmRef = z.string().trim().min(1).max(128);
const leadSchema = z.object({
  enquiry_id: z.string().uuid(),
  crm_lead_id: crmRef,
  // 'converted' is set only by an in-app booking, never by the CRM.
  status: z.enum(["new", "contacted", "qualified", "closed"]).optional(),
});
const contactSchema = z.object({ customer_id: z.string().uuid(), crm_contact_id: crmRef });
const dealSchema = z.object({ booking_id: z.string().uuid(), crm_deal_id: crmRef });
const payoutSchema = z.object({
  settlement_id: z.string().uuid(),
  external_reference: z.string().trim().min(1).max(200),
  amount: z.number().nonnegative().finite(),
  details: z.record(z.unknown()).optional(),
});

class Reject extends Error {}

type Ctx = { q: Queryable; orgId: string; webhookEventId: string; actor: AuditActor };

/**
 * Handlers. Any outbound event enqueued here MUST pass `causedByWebhookEventId: webhookEventId`
 * (loop prevention). The current handlers intentionally enqueue none.
 */
const handlers: Record<InboundEventType, (c: Ctx, data: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  async ping() {
    return { pong: true };
  },
  async "lead.updated"(c, data) {
    const d = parseOrReject(leadSchema, data);
    const rows = await c.q.query<{ id: string; status: string }>(
      `update enquiries set crm_lead_id = $3,
              status = case when status = 'converted' then status else coalesce($4, status) end
        where id = $1 and organization_id = $2 returning id, status`,
      [d.enquiry_id, c.orgId, d.crm_lead_id, d.status ?? null],
    );
    if (rows.length === 0) throw new Reject("Enquiry not found in this organization");
    await writeAudit(c.q, c.actor, {
      action: "enquiry.crm_updated", entityType: "enquiry", entityId: d.enquiry_id,
      summary: "CRM lead reference updated by UNIKLIFE.AI webhook", metadata: { crm_lead_id: d.crm_lead_id, status: rows[0].status, webhook_event_id: c.webhookEventId },
    });
    return { enquiry_id: d.enquiry_id, status: rows[0].status };
  },
  async "contact.updated"(c, data) {
    const d = parseOrReject(contactSchema, data);
    const rows = await c.q.query<{ id: string }>(
      "update customers set crm_contact_id = $3 where id = $1 and organization_id = $2 returning id",
      [d.customer_id, c.orgId, d.crm_contact_id],
    );
    if (rows.length === 0) throw new Reject("Customer not found in this organization");
    await writeAudit(c.q, c.actor, {
      action: "customer.crm_updated", entityType: "customer", entityId: d.customer_id,
      summary: "CRM contact reference updated by UNIKLIFE.AI webhook", metadata: { crm_contact_id: d.crm_contact_id, webhook_event_id: c.webhookEventId },
    });
    return { customer_id: d.customer_id };
  },
  async "deal.updated"(c, data) {
    const d = parseOrReject(dealSchema, data);
    const rows = await c.q.query<{ id: string }>(
      "update bookings set crm_deal_id = $3 where id = $1 and organization_id = $2 returning id",
      [d.booking_id, c.orgId, d.crm_deal_id],
    );
    if (rows.length === 0) throw new Reject("Booking not found in this organization");
    await writeAudit(c.q, c.actor, {
      action: "booking.crm_updated", entityType: "booking", entityId: d.booking_id,
      summary: "CRM deal reference updated by UNIKLIFE.AI webhook", metadata: { crm_deal_id: d.crm_deal_id, webhook_event_id: c.webhookEventId },
    });
    return { booking_id: d.booking_id };
  },
  async "finance.payout_reconciled"(c, data) {
    const d = parseOrReject(payoutSchema, data);
    let r: { id: string; matched: boolean };
    try {
      r = await recordReconciliation(c.q, {
        organizationId: c.orgId, settlementId: d.settlement_id, source: "uniklife_webhook", externalReference: d.external_reference,
        reportedAmount: d.amount, details: d.details ?? {}, webhookEventId: c.webhookEventId,
      });
    } catch (e) {
      if (e instanceof AppError && e.status === 404) throw new Reject("Settlement not found in this organization");
      throw e;
    }
    await writeAudit(c.q, c.actor, {
      action: "reconciliation.received", entityType: "commission_settlement", entityId: d.settlement_id,
      summary: `Finance payout reconciliation received from UNIKLIFE.AI (${r.matched ? "amount matches" : "AMOUNT MISMATCH"}) — awaiting human review`,
      metadata: { reconciliation_id: r.id, external_reference: d.external_reference, amount: d.amount, webhook_event_id: c.webhookEventId },
    });
    // Never marks anything paid: an authorized human must accept the reconciliation.
    return { reconciliation_id: r.id, matched: r.matched, requires_review: true };
  },
};

function parseOrReject<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new Reject(`Invalid data: ${r.error.issues.map((i) => `${i.path.join(".") || "data"} ${i.message}`).join("; ")}`.slice(0, 300));
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleUniklifeWebhook(rawBody: string, headers: {
  connectionId: string | null;
  signature: string | null;
  authorization?: string | null;
  headers?: Headers;
}): Promise<InboundResult> {
  if (Buffer.byteLength(rawBody, "utf8") > INBOUND_MAX_BYTES) return { status: 413, body: { error: "Payload too large" } };
  const db = await getDb();

  // 1. Connection (uniform 401 so connection ids cannot be probed).
  const connId = headers.connectionId?.trim() ?? "";
  if (!UUID.test(connId)) return { status: 401, body: { error: "Unknown or disabled connection" } };
  const [conn] = await db.query<ConnectionRow>("select * from integration_connections where id = $1 and provider = 'uniklife'", [connId]);
  if (!conn || !conn.is_enabled) return { status: 401, body: { error: "Unknown or disabled connection" } };

  // 2. Signature (timestamp tolerance = replay protection). Unsigned/forged requests are not stored.
  const secret = secretFromEnvName(conn.inbound_secret_env);
  const auth = verifyIntegrationAuth({
    type: conn.inbound_auth_type,
    secret,
    rawBody,
    signature: headers.signature,
    authorization: headers.authorization ?? null,
    headers: headers.headers ?? new Headers(),
    headerName: conn.inbound_auth_header_name,
    toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
  });
  if (!auth.ok) return { status: 401, body: { error: auth.reason } };

  const orgId = conn.organization_id;
  const actor: AuditActor = { system: true, organizationId: orgId, actorType: "webhook" };

  // 3. Schema.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = undefined;
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    const fallbackId = typeof (json as { id?: unknown })?.id === "string" ? String((json as { id: string }).id).slice(0, 128) : `invalid-${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
    await recordRejected(db, conn, fallbackId, "invalid", json ?? { raw_excerpt: sanitizeText(rawBody, { max: 500 }) }, "Invalid envelope");
    return { status: 400, body: { error: "Invalid payload" } };
  }
  const evt = parsed.data;
  const externalId = `${conn.id}:${evt.id}`;

  // 4. Unknown types are recorded and rejected.
  if (!(INBOUND_EVENT_TYPES as readonly string[]).includes(evt.type)) {
    const dup = await recordRejected(db, conn, evt.id, evt.type, evt, `Unsupported event type ${evt.type}`.slice(0, 200));
    if (dup) return { status: 200, body: { received: true, duplicate: true } };
    return { status: 422, body: { error: "Unsupported event type", supported: INBOUND_EVENT_TYPES } };
  }

  // 5. De-duplicate (unique (source, external_event_id), namespaced by connection).
  const inserted = await db.query<{ id: string }>(
    `insert into webhook_events (organization_id, connection_id, source, external_event_id, event_type, payload, signature_valid, status)
     values ($1, $2, 'uniklife', $3, $4, $5::jsonb, true, 'queued') on conflict (source, external_event_id) do nothing returning id`,
    [orgId, conn.id, externalId, evt.type, evt],
  );
  let webhookId = inserted[0]?.id;
  if (!webhookId) {
    const [existing] = await db.query<{ id: string; status: string }>(
      "update webhook_events set duplicate_count = duplicate_count + 1 where source = 'uniklife' and external_event_id = $1 returning id, status",
      [externalId],
    );
    // A previous attempt that FAILED (unexpected error) may be re-processed; anything else is a duplicate.
    if (!existing || existing.status !== "failed") return { status: 200, body: { received: true, duplicate: true } };
    webhookId = existing.id;
  }

  // 6. Loop prevention: never re-apply our own events echoed back.
  if (evt.source === EVENT_SOURCE) {
    await finish(db, webhookId, "ignored", "Event originated from uniklife-3d-venture (loop prevention)");
    return { status: 200, body: { received: true, ignored: "own_event" } };
  }

  // 7. Process in a transaction; record the outcome.
  try {
    const result = await db.transaction(async (q) => {
      const out = await handlers[evt.type as InboundEventType]({ q, orgId, webhookEventId: webhookId!, actor }, evt.data);
      await finish(q, webhookId!, "processed", null);
      await writeAudit(q, actor, { action: "webhook.uniklife_processed", entityType: "webhook_event", entityId: webhookId, summary: `Processed ${evt.type}`, metadata: { external_event_id: evt.id } });
      return out;
    });
    return { status: 200, body: { received: true, processed: true, result } };
  } catch (e) {
    if (e instanceof Reject) {
      await db.transaction(async (q) => {
        await finish(q, webhookId!, "rejected", e.message);
        await writeAudit(q, actor, { action: "webhook.uniklife_rejected", entityType: "webhook_event", entityId: webhookId, summary: e.message, metadata: { external_event_id: evt.id, type: evt.type } });
      });
      return { status: 422, body: { received: true, rejected: true, error: e.message } };
    }
    const msg = sanitizeText(e, { max: 300 });
    console.error("[uniklife-webhook] processing failed:", msg);
    await finish(db, webhookId, "failed", msg);
    return { status: 500, body: { error: "Processing failed" } };
  }
}

async function finish(q: Queryable, id: string, status: "processed" | "rejected" | "failed" | "ignored", error: string | null) {
  await q.query("update webhook_events set status = $2, error = $3, processed_at = now(), attempts = attempts + 1 where id = $1", [id, status, error]);
}

/** Records a rejected (but authentic) webhook; returns true when it was a duplicate. */
async function recordRejected(q: Queryable, conn: ConnectionRow, id: string, type: string, payload: unknown, error: string): Promise<boolean> {
  const externalId = `${conn.id}:${id}`;
  const ins = await q.query<{ id: string }>(
    `insert into webhook_events (organization_id, connection_id, source, external_event_id, event_type, payload, signature_valid, status, error, processed_at, attempts)
     values ($1, $2, 'uniklife', $3, $4, $5::jsonb, true, 'rejected', $6, now(), 1) on conflict (source, external_event_id) do nothing returning id`,
    [conn.organization_id, conn.id, externalId, type.slice(0, 100), payload ?? {}, error],
  );
  if (ins.length === 0) {
    await q.query("update webhook_events set duplicate_count = duplicate_count + 1 where source = 'uniklife' and external_event_id = $1", [externalId]);
    return true;
  }
  await writeAudit(q, { system: true, organizationId: conn.organization_id, actorType: "webhook" }, {
    action: "webhook.uniklife_rejected", entityType: "webhook_event", entityId: ins[0].id, summary: error, metadata: { external_event_id: id },
  });
  return false;
}
