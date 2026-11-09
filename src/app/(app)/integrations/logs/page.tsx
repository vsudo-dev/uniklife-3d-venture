import { IntegrationNav } from "@/components/integrations/integration-nav";
import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { listMockRecords, listOutbound, listWebhookEvents } from "@/lib/services/integration";
import { OUTBOUND_EVENT_TYPES } from "@/lib/integration/events";
import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { OutboundRowActions } from "@/components/integrations/outbound-row-actions";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Webhook delivery logs" };

const TABS = [
  { key: "outbound", label: "Outbound" },
  { key: "inbound", label: "Inbound" },
  { key: "mock", label: "Mock CRM inbox" },
] as const;

const OUT_STATUSES = ["", "pending", "delivered", "failed", "dead_letter", "skipped"];
const IN_STATUSES = ["", "queued", "processed", "rejected", "failed", "ignored"];

function short(id: string | null | undefined) {
  return id ? `${id.slice(0, 8)}…` : "—";
}

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function IntegrationLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("integration.manage");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "outbound";

  return (
    <>
      {sp.embedded !== "1" && <IntegrationNav />}
      <PageHeader
        eyebrow="Administration"
        title="Webhook delivery logs"
        subtitle="Outbound deliveries to UNIKLIFE.AI (via the configured connector), inbound UNIKLIFE.AI webhooks, and what the MOCK connector received. Responses are sanitized and truncated; secrets are never logged."
        actions={<LinkButton href="/integrations" variant="outline">Integration settings</LinkButton>}
      />

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1" aria-label="Log type">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/integrations/logs?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold", tab === t.key ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "outbound" && <OutboundTab ctxStatus={sp.status} ctxType={sp.type} ctx={ctx} />}
      {tab === "inbound" && <InboundTab status={sp.status} ctx={ctx} />}
      {tab === "mock" && <MockTab ctx={ctx} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>;

async function OutboundTab({ ctx, ctxStatus, ctxType }: { ctx: Ctx; ctxStatus?: string; ctxType?: string }) {
  const rows = await listOutbound(ctx, { status: ctxStatus || undefined, type: ctxType || undefined });
  return (
    <>
      <form className="mb-4 flex flex-wrap gap-2" action="/integrations/logs">
        <input type="hidden" name="tab" value="outbound" />
        <select name="status" defaultValue={ctxStatus ?? ""} className="input max-w-[200px]" aria-label="Filter by status">
          {OUT_STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "All statuses"}</option>)}
        </select>
        <select name="type" defaultValue={ctxType ?? ""} className="input max-w-[280px]" aria-label="Filter by event type">
          <option value="">All event types</option>
          {OUTBOUND_EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-contrast">Filter</button>
      </form>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No outbound events">Events are queued when bookings, payments, commissions and other records change.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th><th>Type</th><th>Status</th><th>Retries</th><th>Source record</th><th>Destination</th>
                  <th>External ref</th><th>Timestamps</th><th>Response</th><th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="font-mono text-xs" title={r.id}>{short(r.id)}<div className="text-muted" title={r.organization_id}>{r.organization_name}</div></td>
                    <td className="text-xs"><span className="font-mono">{r.event_type}</span></td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.caused_by_webhook_event_id && <div className="mt-1"><Badge>loop-suppressed</Badge></div>}
                    </td>
                    <td className="text-xs">{r.attempts}/{r.max_attempts}{r.status === "failed" && <div className="text-muted">next {dateTime(r.next_attempt_at)}</div>}</td>
                    <td className="text-xs">{r.aggregate_type}<div className="font-mono text-muted" title={r.aggregate_id ?? ""}>{short(r.aggregate_id)}</div></td>
                    <td className="text-xs">{r.connection_name ?? "—"}{r.connection_mode && <div><Badge tone={r.connection_mode === "mock" ? "gold" : "danger"}>{r.connection_mode.toUpperCase()}</Badge></div>}</td>
                    <td className="font-mono text-xs">{r.external_reference ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs text-muted">
                      <div>created {dateTime(r.created_at)}</div>
                      {r.last_attempt_at && <div>last try {dateTime(r.last_attempt_at)}</div>}
                      {r.delivered_at && <div>delivered {dateTime(r.delivered_at)}</div>}
                    </td>
                    <td className="min-w-[14rem] text-xs">
                      {r.last_response_status != null && <div>HTTP {r.last_response_status}</div>}
                      {r.last_error && <div className="text-danger">{r.last_error}</div>}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-primary">Attempts ({r.attempts_log.length}) &amp; response</summary>
                        <div className="mt-2 space-y-2">
                          {r.attempts_log.length === 0 ? <div className="text-muted">No attempts yet.</div> : (
                            <ol className="space-y-1">
                              {r.attempts_log.map((a) => (
                                <li key={a.attempt_no + a.created_at} className="rounded-lg border border-border p-2">
                                  #{a.attempt_no} · {a.success ? <span className="text-success">ok</span> : <span className="text-danger">failed</span>}
                                  {a.response_status != null && ` · HTTP ${a.response_status}`} · {a.connector_mode} · {a.duration_ms ?? 0} ms
                                  <div className="text-muted">{dateTime(a.created_at)}</div>
                                  {a.error && <div className="text-danger">{a.error}</div>}
                                </li>
                              ))}
                            </ol>
                          )}
                          {r.last_response_excerpt && <div><div className="font-semibold">Last response (sanitized)</div><pre className="whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2">{r.last_response_excerpt}</pre></div>}
                          <div className="font-mono text-muted">key: {r.idempotency_key}</div>
                        </div>
                      </details>
                    </td>
                    <td><OutboundRowActions id={r.id} status={r.status} loopSuppressed={!!r.caused_by_webhook_event_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function InboundTab({ ctx, status }: { ctx: Ctx; status?: string }) {
  const rows = await listWebhookEvents(ctx, { status: status || undefined });
  return (
    <>
      <form className="mb-4 flex flex-wrap gap-2" action="/integrations/logs">
        <input type="hidden" name="tab" value="inbound" />
        <select name="status" defaultValue={status ?? ""} className="input max-w-[200px]" aria-label="Filter by status">
          {IN_STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        <button className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-contrast">Filter</button>
      </form>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No inbound webhooks yet">Signed requests from UNIKLIFE.AI to the inbound endpoint appear here, including duplicates and rejections. Requests with an invalid signature are refused and not stored.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Event id</th><th>Type</th><th>Status</th><th>Duplicates</th><th>Received</th><th>Processed</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="align-top">
                    <td className="max-w-[14rem] break-all font-mono text-xs">{w.external_event_id.replace(/^[0-9a-f-]{36}:/, "")}</td>
                    <td className="font-mono text-xs">{w.event_type}</td>
                    <td><StatusBadge status={w.status} />{w.signature_valid && <div className="mt-1 text-xs text-muted">signature ok</div>}</td>
                    <td className="text-xs">{w.duplicate_count > 0 ? <Badge tone="info">{w.duplicate_count} duplicate(s)</Badge> : "—"}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{dateTime(w.received_at)}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{w.processed_at ? dateTime(w.processed_at) : "—"}</td>
                    <td className="min-w-[14rem] text-xs">
                      {w.error && <div className={w.status === "ignored" ? "text-muted" : "text-danger"}>{w.error}</div>}
                      <details className="mt-1"><summary className="cursor-pointer text-primary">Payload</summary><Json value={w.payload} /></details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function MockTab({ ctx }: { ctx: Ctx }) {
  const rows = await listMockRecords(ctx);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-5 py-3 text-sm text-muted">
        Records the <strong>MOCK</strong> UNIKLIFE.AI connector accepted. Nothing here was sent to a real CRM. Replays with the same idempotency key are de-duplicated.
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Mock inbox is empty">Use &quot;Send test event&quot; on the settings page, or create a booking/enquiry and dispatch.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Received</th><th>Event type</th><th>Idempotency key</th><th>Envelope</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="whitespace-nowrap text-xs text-muted">{dateTime(m.received_at)}</td>
                  <td className="font-mono text-xs">{m.event_type}{m.payload?.test === true && <div><Badge tone="info">test</Badge></div>}</td>
                  <td className="max-w-[16rem] break-all font-mono text-xs">{m.idempotency_key}</td>
                  <td className="min-w-[16rem] text-xs"><details><summary className="cursor-pointer text-primary">View envelope</summary><Json value={m.payload} /></details></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
