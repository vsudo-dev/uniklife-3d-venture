import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { createTestDb, ctxFor, demoVenture, key, plotIds } from "../support/db";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { buildEnvelope, processOutbox } from "@/lib/integration/dispatcher";
import { computeBackoff } from "@/lib/integration/backoff";
import { HttpConnector, MockConnector, mockConnectorTestHooks, type ConnectionRow } from "@/lib/integration/connectors";
import { handleUniklifeWebhook } from "@/lib/integration/inbound";
import { signPayload } from "@/lib/webhooks/signature";
import { redeliverOutbound, sendTestEvent, updateConnection, verifyLive, getConnection, listOutbound } from "@/lib/services/integration";
import { POST as webhookPOST } from "@/app/api/webhooks/uniklife/incoming/route";
import { GET as cronGET, POST as cronPOST } from "@/app/api/cron/run/route";
import { AppError } from "@/lib/errors";

let db: Database;
let orgA: string;
let orgB: string;
let connA: ConnectionRow;
let ceo: AuthContext;
let ventureId: string;
const INBOUND_SECRET = process.env.UNIKLIFE_WEBHOOK_SECRET!;

beforeAll(async () => {
  db = await createTestDb();
  const v = await demoVenture(db);
  ventureId = v.id;
  orgA = v.organization_id;
  [{ id: orgB }] = await db.query<{ id: string }>("select id from organizations where slug = 'sample-realty-b'");
  [connA] = await db.query<ConnectionRow>("select * from integration_connections where organization_id = $1", [orgA]);
  ceo = await ctxFor(db, "ceo@demo.local");
});

afterEach(() => mockConnectorTestHooks.reset());

async function enqueue(eventType: "plot.enquiry.created" | "plot.booking.created" = "plot.enquiry.created", idem = key("ev")) {
  await db.transaction((q) =>
    enqueueOutboundEvent(q, { organizationId: orgA, eventType, aggregateType: "enquiry", aggregateId: randomUUID(), idempotencyKey: idem, data: { sample: true } }),
  );
  const [row] = await db.query<{ id: string; status: string }>("select id, status from outbound_events where idempotency_key = $1", [idem]);
  return { id: row.id, idem };
}

const getEvent = async (id: string) =>
  (await db.query<Record<string, unknown>>("select * from outbound_events where id = $1", [id]))[0];

describe("outbound dispatcher → mock connector", () => {
  it("delivers an event, applies event mappings and records a mock CRM record", async () => {
    await db.query("update integration_connections set event_mappings = $2::jsonb where id = $1", [connA.id, { "plot.enquiry.created": "proposed.lead.create" }]);
    const { id, idem } = await enqueue();
    const s = await processOutbox({ organizationId: orgA, eventIds: [id] });
    expect(s).toMatchObject({ claimed: 1, delivered: 1 });
    const ev = await getEvent(id);
    expect(ev.status).toBe("delivered");
    expect(String(ev.external_reference)).toMatch(/^MOCK-[0-9A-F]{12}$/);
    expect(ev.last_response_status).toBe(201);
    expect(String(ev.last_response_excerpt).length).toBeLessThanOrEqual(500);
    const recs = await db.query<{ event_type: string; payload: Record<string, unknown> }>("select event_type, payload from mock_uniklife_records where idempotency_key = $1", [idem]);
    expect(recs).toHaveLength(1);
    expect(recs[0].event_type).toBe("proposed.lead.create");
    expect(recs[0].payload).toMatchObject({ type: "plot.enquiry.created", mapped_type: "proposed.lead.create", source: "uniklife-3d-venture", idempotency_key: idem, simulated: true });
    const attempts = await db.query<{ success: boolean; connector_mode: string }>("select success, connector_mode from outbound_delivery_attempts where outbound_event_id = $1", [id]);
    expect(attempts).toEqual([{ success: true, connector_mode: "mock" }]);
    const [c] = await db.query<{ last_success_at: Date | null }>("select last_success_at from integration_connections where id = $1", [connA.id]);
    expect(c.last_success_at).not.toBeNull();
    await db.query("update integration_connections set event_mappings = '{}'::jsonb where id = $1", [connA.id]);
  });

  it("retries with exponential backoff, dead-letters after max attempts, and a manual retry delivers", async () => {
    const { id, idem } = await enqueue("plot.booking.created");
    await db.query("update integration_connections set event_mappings = $2::jsonb where id = $1", [connA.id, { __mock_fail_next: 6 }]);
    for (let n = 1; n <= 6; n++) {
      const s = await processOutbox({ organizationId: orgA, eventIds: [id], random: () => 0.5 });
      expect(s.claimed).toBe(1);
      const ev = await getEvent(id);
      expect(ev.attempts).toBe(n);
      if (n < 6) {
        expect(ev.status).toBe("failed");
        const delay = new Date(ev.next_attempt_at as Date).getTime() - new Date(ev.last_attempt_at as Date).getTime();
        expect(Math.abs(delay - computeBackoff(n))).toBeLessThan(2000);
        // Not due yet → a dispatcher run does not pick it up.
        expect((await processOutbox({ organizationId: orgA, eventIds: [id] })).claimed).toBe(0);
        await db.query("update outbound_events set next_attempt_at = now() where id = $1", [id]);
      } else {
        expect(ev.status).toBe("dead_letter");
        expect(String(ev.last_error)).toContain("Simulated mock failure");
      }
    }
    const [c] = await db.query<{ event_mappings: Record<string, unknown>; last_error: string | null }>("select event_mappings, last_error from integration_connections where id = $1", [connA.id]);
    expect(c.event_mappings.__mock_fail_next).toBe(0);
    expect(c.last_error).toContain("Simulated");
    expect(await db.query("select 1 from mock_uniklife_records where idempotency_key = $1", [idem])).toHaveLength(0);

    const r = await redeliverOutbound(ceo, id, "retry");
    expect(r.delivered).toBe(1);
    const ev = await getEvent(id);
    expect(ev.status).toBe("delivered");
    expect(ev.attempts).toBe(1);
    const attempts = await db.query<{ n: number }>("select count(*)::int as n from outbound_delivery_attempts where outbound_event_id = $1", [id]);
    expect(attempts[0].n).toBe(7);
    expect(await db.query("select 1 from mock_uniklife_records where idempotency_key = $1", [idem])).toHaveLength(1);
  });

  it("the test hook can simulate failures too", async () => {
    const { id } = await enqueue();
    mockConnectorTestHooks.failNext(1);
    const s = await processOutbox({ organizationId: orgA, eventIds: [id] });
    expect(s.failed).toBe(1);
    expect((await getEvent(id)).status).toBe("failed");
  });

  it("a replay with the same idempotency key does not double-insert into mock records", async () => {
    const { id, idem } = await enqueue();
    await processOutbox({ organizationId: orgA, eventIds: [id] });
    const first = (await getEvent(id)).external_reference;
    const r = await redeliverOutbound(ceo, id, "replay");
    expect(r.delivered).toBe(1);
    const ev = await getEvent(id);
    expect(ev.external_reference).toBe(first);
    expect(ev.last_response_status).toBe(200);
    expect(await db.query("select 1 from mock_uniklife_records where idempotency_key = $1", [idem])).toHaveLength(1);

    // Direct connector call with the same key is also de-duplicated.
    const out = await new MockConnector().send(
      { id, type: "plot.enquiry.created", version: 1, source: "uniklife-3d-venture", occurred_at: new Date().toISOString(), organization_id: orgA,
        source_record_id: null, idempotency_key: idem, simulated: true, test: false, data: {} },
      connA,
    );
    expect(out.ok).toBe(true);
    expect(await db.query("select 1 from mock_uniklife_records where idempotency_key = $1", [idem])).toHaveLength(1);
    // Retry is not allowed for a delivered event.
    await expect(redeliverOutbound(ceo, id, "retry")).rejects.toBeInstanceOf(AppError);
  });

  it("enqueueing the same idempotency key twice creates one outbox row", async () => {
    const idem = key("dup");
    await enqueue("plot.enquiry.created", idem);
    await enqueue("plot.enquiry.created", idem);
    const rows = await db.query("select 1 from outbound_events where idempotency_key = $1", [idem]);
    expect(rows).toHaveLength(1);
  });

  it("sends a test event with safe sample data", async () => {
    const r = await sendTestEvent(ceo);
    expect(r.delivered).toBe(1);
    const [rec] = await db.query<{ payload: Record<string, unknown> }>(
      "select m.payload from mock_uniklife_records m join outbound_events e on e.idempotency_key = m.idempotency_key where e.id = $1",
      [r.eventId],
    );
    expect(rec.payload).toMatchObject({ type: "integration.test", test: true, data: { test: true } });
    expect(JSON.stringify(rec.payload)).not.toMatch(/@|\+91/);
    const list = await listOutbound(ceo, { type: "integration.test" });
    expect(list[0].attempts_log.length).toBeGreaterThan(0);
  });

  it("adds the documented CRM parameter aliases to the outgoing data", () => {
    const envelope = buildEnvelope({
      id: randomUUID(), organization_id: orgA, connection_id: connA.id, event_type: "plot.booking.created",
      aggregate_type: "booking", aggregate_id: randomUUID(),
      payload: {
        booking_id: "booking-1", booking_number: "B-1", venture_id: "venture-1", venture_name: "Sample",
        plots: [{ plot_number: "P-1", area_sq_yards: 120 }], customer: { id: "customer-1", name: "Sample Customer", phone: "9000000000" },
      },
      idempotency_key: key("params"), status: "pending", attempts: 0, max_attempts: 6, created_at: new Date(),
    }, connA);
    expect(envelope.data).toMatchObject({
      customer_id: "customer-1", customer_name: "Sample Customer", customer_phone: "9000000000",
      project_id: "venture-1", project_name: "Sample", plot_number: "P-1", plot_numbers: ["P-1"],
      plot_area_sq_yards: 120,
    });
  });

  it("fans each business event out to every enabled API connection", async () => {
    const extra = await updateConnection(ceo, {
      connection_type: "api", name: "Secondary CRM", is_enabled: true, destination_url: null, auth_type: "hmac",
      inbound_auth_type: "hmac", outbound_auth_header_name: "X-API-Key", inbound_auth_header_name: "X-API-Key",
      outbound_secret_env: null, inbound_secret_env: null, event_mappings: {},
    }, true);
    const idem = key("fanout");
    try {
      await enqueue("plot.enquiry.created", idem);
      const rows = await db.query<{ id: string; connection_id: string }>(
        "select id, connection_id from outbound_events where idempotency_key = $1 or idempotency_key = $2 order by connection_id",
        [idem, `${idem}:${extra.id}`],
      );
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.connection_id))).toEqual(new Set([connA.id, extra.id]));
      expect((await processOutbox({ organizationId: orgA, eventIds: rows.map((row) => row.id) })).delivered).toBe(2);
    } finally {
      await db.query("delete from outbound_events where idempotency_key = $1 or idempotency_key = $2", [idem, `${idem}:${extra.id}`]);
      await db.query("delete from integration_connections where id = $1", [extra.id]);
    }
  });

  it("the HTTP connector refuses to run unless live is enabled and verified", async () => {
    const http = new HttpConnector();
    const envelope = { id: randomUUID(), type: "integration.test" as const, version: 1 as const, source: "uniklife-3d-venture" as const, occurred_at: new Date().toISOString(),
      organization_id: orgA, source_record_id: null, idempotency_key: key("h"), simulated: false, test: true, data: {} };
    await expect(http.send(envelope, { ...connA, mode: "live", live_verified: true, destination_url: "https://example.invalid/hook" }))
      .rejects.toMatchObject({ code: "integration_disabled" });
    process.env.UNIKLIFE_LIVE_ENABLED = "true";
    try {
      await expect(http.send(envelope, { ...connA, mode: "mock", live_verified: false })).rejects.toMatchObject({ code: "integration_disabled" });
    } finally {
      delete process.env.UNIKLIFE_LIVE_ENABLED;
    }
  });

  it("only an org admin can verify live mode; settings validate env names and https", async () => {
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    await expect(verifyLive(lakshmi, { enable: true, confirmation: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(updateConnection(ceo, { name: "X1", is_enabled: true, destination_url: "http://insecure.example", auth_type: "hmac",
      outbound_secret_env: "UNIKLIFE_OUTBOUND_SECRET", inbound_secret_env: "UNIKLIFE_WEBHOOK_SECRET", event_mappings: {} })).rejects.toBeTruthy();
    await expect(updateConnection(ceo, { name: "X1", is_enabled: true, destination_url: null, auth_type: "hmac",
      outbound_secret_env: "lower-case", inbound_secret_env: "UNIKLIFE_WEBHOOK_SECRET", event_mappings: {} })).rejects.toBeTruthy();
    const view = await getConnection(ceo);
    expect(view?.effective_mode).toBe("mock");
    expect(view?.env_status).toEqual({ outbound_secret_env: true, inbound_secret_env: true });
    expect(JSON.stringify(view)).not.toContain(INBOUND_SECRET);
  });
});

// ---------------------------------------------------------------------------
// Inbound webhook
// ---------------------------------------------------------------------------
function signed(body: Record<string, unknown>, opts: { secret?: string; ts?: number; conn?: string } = {}) {
  const raw = JSON.stringify(body);
  return { raw, headers: { connectionId: opts.conn ?? connA.id, signature: signPayload(opts.secret ?? INBOUND_SECRET, raw, opts.ts) } };
}
const evt = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: `evt_${randomUUID()}`, type, occurred_at: new Date().toISOString(), data, ...extra,
});

async function makeEnquiry(org: string, venture: string, plotId: string | null = null) {
  const [e] = await db.query<{ id: string }>(
    "insert into enquiries (organization_id, venture_id, plot_id, name, phone, source) values ($1,$2,$3,'Test Lead','+910000000001','web') returning id",
    [org, venture, plotId],
  );
  return e.id;
}

describe("inbound UNIKLIFE.AI webhook", () => {
  it("rejects a bad signature with 401 and stores nothing", async () => {
    const e = evt("ping", {});
    const { raw, headers } = signed(e, { secret: "wrong-secret-0123456789abcdefgh" });
    const r = await handleUniklifeWebhook(raw, headers);
    expect(r.status).toBe(401);
    expect(await db.query("select 1 from webhook_events where external_event_id like $1", [`%${e.id}`])).toHaveLength(0);
  });

  it("rejects an expired signature (replay protection)", async () => {
    const { raw, headers } = signed(evt("ping", {}), { ts: Math.floor(Date.now() / 1000) - 600 });
    expect((await handleUniklifeWebhook(raw, headers)).status).toBe(401);
  });

  it("accepts a bearer token for CRM webhook actions that do not support HMAC signing", async () => {
    await db.query("update integration_connections set inbound_auth_type = 'bearer' where id = $1", [connA.id]);
    const raw = JSON.stringify(evt("ping", {}));
    const r = await handleUniklifeWebhook(raw, {
      connectionId: connA.id,
      signature: null,
      authorization: `Bearer ${INBOUND_SECRET}`,
    });
    expect(r.status).toBe(200);
    expect(r.body.processed).toBe(true);
    await db.query("update integration_connections set inbound_auth_type = 'hmac' where id = $1", [connA.id]);
  });

  it("rejects an incorrect bearer token", async () => {
    await db.query("update integration_connections set inbound_auth_type = 'bearer' where id = $1", [connA.id]);
    const e = evt("ping", {});
    const raw = JSON.stringify(e);
    const r = await handleUniklifeWebhook(raw, {
      connectionId: connA.id,
      signature: null,
      authorization: "Bearer wrong-secret-0123456789",
    });
    expect(r.status).toBe(401);
    expect(await db.query("select 1 from webhook_events where external_event_id = $1", [`${connA.id}:${e.id}`])).toHaveLength(0);
    await db.query("update integration_connections set inbound_auth_type = 'hmac' where id = $1", [connA.id]);
  });

  it("rejects unknown connections", async () => {
    const { raw, headers } = signed(evt("ping", {}), { conn: randomUUID() });
    expect((await handleUniklifeWebhook(raw, headers)).status).toBe(401);
    const bad = signed(evt("ping", {}), { conn: "not-a-uuid" });
    expect((await handleUniklifeWebhook(bad.raw, bad.headers)).status).toBe(401);
  });

  it("rejects unknown event types and records the rejection", async () => {
    const e = evt("plot.status_changed", { plot_id: randomUUID(), status: "sold" });
    const { raw, headers } = signed(e);
    const r = await handleUniklifeWebhook(raw, headers);
    expect(r.status).toBe(422);
    const [w] = await db.query<{ status: string }>("select status from webhook_events where external_event_id = $1", [`${connA.id}:${e.id}`]);
    expect(w.status).toBe("rejected");
  });

  it("de-duplicates by event id and processes once", async () => {
    const enquiryId = await makeEnquiry(orgA, ventureId);
    const e = evt("lead.updated", { enquiry_id: enquiryId, crm_lead_id: "CRM-LEAD-1" });
    const { raw, headers } = signed(e);
    const first = await handleUniklifeWebhook(raw, headers);
    expect(first.status).toBe(200);
    expect(first.body.processed).toBe(true);
    const again = signed(e); // fresh signature, same event id
    const second = await handleUniklifeWebhook(again.raw, again.headers);
    expect(second).toEqual({ status: 200, body: { received: true, duplicate: true } });
    const [w] = await db.query<{ status: string; duplicate_count: number }>("select status, duplicate_count from webhook_events where external_event_id = $1", [`${connA.id}:${e.id}`]);
    expect(w).toEqual({ status: "processed", duplicate_count: 1 });
    const audits = await db.query("select 1 from audit_logs where action = 'enquiry.crm_updated' and entity_id = $1 and actor_type = 'webhook'", [enquiryId]);
    expect(audits).toHaveLength(1);
  });

  it("ignores events whose source is this app (loop prevention)", async () => {
    const enquiryId = await makeEnquiry(orgA, ventureId);
    const e = evt("lead.updated", { enquiry_id: enquiryId, crm_lead_id: "LOOP-1" }, { source: "uniklife-3d-venture" });
    const { raw, headers } = signed(e);
    const r = await handleUniklifeWebhook(raw, headers);
    expect(r.body.ignored).toBe("own_event");
    const [w] = await db.query<{ status: string }>("select status from webhook_events where external_event_id = $1", [`${connA.id}:${e.id}`]);
    expect(w.status).toBe("ignored");
    const [enq] = await db.query<{ crm_lead_id: string | null }>("select crm_lead_id from enquiries where id = $1", [enquiryId]);
    expect(enq.crm_lead_id).toBeNull();
  });

  it("lead.updated only sets crm_lead_id/status and cannot change plot status", async () => {
    const [plotId] = await plotIds(db, ventureId, ["30"]);
    const [before] = await db.query<{ status: string }>("select status from plots where id = $1", [plotId]);
    const enquiryId = await makeEnquiry(orgA, ventureId, plotId);
    const e = evt("lead.updated", {
      enquiry_id: enquiryId, crm_lead_id: "CRM-LEAD-42", status: "qualified",
      plot_id: plotId, plot_status: "sold", price: 1, booking_status: "confirmed", name: "Hacked",
    });
    const { raw, headers } = signed(e);
    const r = await handleUniklifeWebhook(raw, headers);
    expect(r.status).toBe(200);
    const [enq] = await db.query<{ crm_lead_id: string; status: string; name: string }>("select crm_lead_id, status, name from enquiries where id = $1", [enquiryId]);
    expect(enq).toEqual({ crm_lead_id: "CRM-LEAD-42", status: "qualified", name: "Test Lead" });
    const [after] = await db.query<{ status: string }>("select status from plots where id = $1", [plotId]);
    expect(after.status).toBe(before.status);
    // A CRM cannot mark an enquiry 'converted'.
    const conv = signed(evt("lead.updated", { enquiry_id: enquiryId, crm_lead_id: "CRM-LEAD-42", status: "converted" }));
    expect((await handleUniklifeWebhook(conv.raw, conv.headers)).status).toBe(422);
  });

  it("cross-organization updates (org B enquiry via org A connection) have no effect", async () => {
    const [vB] = await db.query<{ id: string }>("select id from ventures where organization_id = $1 limit 1", [orgB]);
    const enquiryB = await makeEnquiry(orgB, vB.id);
    const e = evt("lead.updated", { enquiry_id: enquiryB, crm_lead_id: "CROSS-ORG", status: "closed" });
    const { raw, headers } = signed(e);
    const r = await handleUniklifeWebhook(raw, headers);
    expect(r.status).toBe(422);
    const [enq] = await db.query<{ crm_lead_id: string | null; status: string }>("select crm_lead_id, status from enquiries where id = $1", [enquiryB]);
    expect(enq).toEqual({ crm_lead_id: null, status: "new" });
    const [w] = await db.query<{ status: string; organization_id: string }>("select status, organization_id from webhook_events where external_event_id = $1", [`${connA.id}:${e.id}`]);
    expect(w).toEqual({ status: "rejected", organization_id: orgA });
  });

  it("deal.updated sets only crm_deal_id; finance.payout_reconciled is recorded for review", async () => {
    const [b] = await db.query<{ id: string; status: string }>("select id, status from bookings where organization_id = $1 limit 1", [orgA]);
    const d = signed(evt("deal.updated", { booking_id: b.id, crm_deal_id: "DEAL-9", status: "cancelled" }));
    expect((await handleUniklifeWebhook(d.raw, d.headers)).status).toBe(200);
    const [after] = await db.query<{ status: string; crm_deal_id: string }>("select status, crm_deal_id from bookings where id = $1", [b.id]);
    expect(after).toEqual({ status: b.status, crm_deal_id: "DEAL-9" });

    const missing = signed(evt("finance.payout_reconciled", { settlement_id: randomUUID(), external_reference: "UTR1", amount: 10 }));
    const r = await handleUniklifeWebhook(missing.raw, missing.headers);
    expect(r.status).toBe(422);
  });

  it("the route handler reads the raw body and headers", async () => {
    const e = evt("ping", {});
    const raw = JSON.stringify(e);
    const req = new Request("http://localhost/api/webhooks/uniklife/incoming", {
      method: "POST",
      headers: { "content-type": "application/json", "x-uniklife-connection": connA.id, "x-uniklife-signature": signPayload(INBOUND_SECRET, raw) },
      body: raw,
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, processed: true });

    const big = new Request("http://localhost/api/webhooks/uniklife/incoming", {
      method: "POST", headers: { "x-uniklife-connection": connA.id }, body: "x".repeat(300 * 1024),
    });
    expect((await webhookPOST(big)).status).toBe(413);

    const unsigned = new Request("http://localhost/api/webhooks/uniklife/incoming", { method: "POST", headers: { "x-uniklife-connection": connA.id }, body: raw });
    expect((await webhookPOST(unsigned)).status).toBe(401);
  });
});

describe("cron endpoint", () => {
  it("rejects requests without the CRON_SECRET bearer token", async () => {
    expect((await cronGET(new Request("http://localhost/api/cron/run"))).status).toBe(401);
    expect((await cronPOST(new Request("http://localhost/api/cron/run", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });

  it("runs all jobs with the right secret", async () => {
    const res = await cronGET(new Request("http://localhost/api/cron/run", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.jobs)).toEqual(["expireStale", "reminders", "outbox", "push"]);
    for (const j of Object.values(body.jobs) as { ok: boolean }[]) expect(j.ok).toBe(true);
    // Push is not configured in tests → pending notifications become 'unavailable'.
    expect(body.jobs.push.result).toMatchObject({ sent: 0 });
  });
});
