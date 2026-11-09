"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Badge, Button, Field } from "@/components/ui";
import { CopyField } from "@/components/integrations/copy-field";

export interface ConnectionFormValue {
  connection_type: "api" | "webhook" | "both";
  name: string;
  is_enabled: boolean;
  destination_url: string | null;
  auth_type: "hmac" | "bearer" | "basic" | "api_key" | "custom_header";
  inbound_auth_type: "hmac" | "bearer" | "basic" | "api_key" | "custom_header";
  outbound_auth_header_name: string;
  inbound_auth_header_name: string;
  outbound_secret_env: string | null;
  inbound_secret_env: string | null;
  event_mappings: Record<string, unknown>;
}

interface Props {
  view?: "api" | "webhook";
  initial: ConnectionFormValue | null;
  envStatus: { outbound_secret_env: boolean; inbound_secret_env: boolean } | null;
  inboundUrl: string;
  connectionId: string | null;
  onCreated?: () => void;
}

function EnvBadge({ set, saved }: { set: boolean | undefined; saved: boolean }) {
  if (!saved) return <Badge>save to check</Badge>;
  return set ? <Badge tone="success">set on server</Badge> : <Badge tone="danger">not set</Badge>;
}

/** One authentication list shared by the app, the API tab and the Webhook tab. */
export const AUTH_OPTIONS = [
  ["hmac", "HMAC signature"],
  ["bearer", "Bearer token"],
  ["basic", "Basic authentication"],
  ["api_key", "API key header"],
  ["custom_header", "Custom header"],
] as const;

function AuthOptions() {
  return <>{AUTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy parameter code" aria-label={`Copy ${code}`} className="text-right"
      onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => undefined); }}>
      <code className="text-xs">{copied ? "copied ✓" : code}</code>
    </button>
  );
}

const API_PARAMETER_GROUPS = [
  {
    category: "Customer & enquiry",
    parameters: [["Customer name", "customer_name"], ["Phone number", "customer_phone"], ["Email address", "customer_email"], ["Customer ID", "customer_id"], ["Enquiry ID", "enquiry_id"], ["Enquiry message", "message"], ["Lead source", "source"]],
  },
  {
    category: "Project & plots",
    parameters: [["Project name", "project_name"], ["Project ID", "project_id"], ["Plot number", "plot_number"], ["Plot numbers", "plot_numbers"], ["Plot area (sq. yards)", "plot_area_sq_yards"], ["Base amount", "base_amount"], ["Net amount", "net_amount"], ["Total area (sq. yards)", "total_area_sq_yards"]],
  },
  {
    category: "Booking & payment",
    parameters: [["Booking number", "booking_number"], ["Booking ID", "booking_id"], ["Payment status", "payment_status"], ["Advance amount", "advance_amount"], ["Discount amount", "discount_amount"], ["Currency", "currency"], ["Payment due date", "payment_due_at"], ["Verified payment amount", "verified_payments"], ["Payment ID", "payment_id"], ["Payment amount", "payment_amount"], ["Payment provider", "payment_provider"], ["Payment method", "payment_method"], ["Payment reference", "payment_reference"], ["Refund review required", "refund_review_required"]],
  },
  {
    category: "Discount",
    parameters: [["Discount name", "discount_name"], ["Discount code", "discount_code"], ["Discount amount", "discount_amount"], ["Discount ID", "discount_id"]],
  },
  {
    category: "Sales team",
    parameters: [["Employee name", "employee_name"], ["Employee ID", "employee_id"], ["Employee code", "employee_code"], ["Designation", "designation"], ["Commission level", "commission_level"], ["Reporting manager ID", "reporting_manager_id"], ["Employment status", "employment_status"], ["Selling employee code", "selling_employee_code"]],
  },
  {
    category: "Commission",
    parameters: [["Commission total", "commission_total_amount"], ["Commission basis", "commission_basis"], ["Plan version", "plan_version"], ["Payee name", "payees[].name"], ["Payee employee code", "commission_entries[].employee_code"], ["Payee role", "commission_entries[].role"], ["Commission level", "commission_entries[].level"], ["Commission amount", "commission_entries[].amount"], ["Commission rate", "commission_entries[].rate_percent / rate_per_sq_yard"], ["Sale value", "commission_entries[].sale_value"], ["Commission area", "commission_entries[].area_sq_yards"], ["Settlement ID", "settlement_id"], ["Settlement reference", "settlement_reference"], ["Settlement period", "period_start / period_end"], ["Payment confirmation reference", "payment_reference"]],
  },
  {
    category: "Site visit",
    parameters: [["Site visit ID", "site_visit_id"], ["Visitor name", "visitor_name"], ["Visitor phone", "visitor_phone"], ["Visit date and time", "scheduled_at"], ["Visit status", "status"], ["Visit outcome", "outcome"], ["Completion date and time", "completed_at"], ["Project name", "project_name"], ["Project ID", "project_id"], ["Plot numbers", "plot_numbers"], ["Customer ID", "customer_id"], ["Trip started", "trip.trip_started_at"], ["Arrival time", "trip.arrived_at"], ["Visit started", "trip.visit_started_at"]],
  },
  {
    category: "Hold & follow-up",
    parameters: [["Hold ID", "hold_group_id"], ["Hold expiry date and time", "expires_at"], ["Reminder ID", "reminder_id"], ["Reminder date and time", "scheduled_at"], ["Follow-up type", "kind"], ["Reason", "reason"]],
  },
  {
    category: "Request details",
    parameters: [["Event ID", "id"], ["Event type", "type"], ["Event date and time", "occurred_at"], ["Organization ID", "organization_id"], ["Record ID", "source_record_id"], ["Idempotency key", "idempotency_key"], ["Test indicator", "test"], ["Simulated indicator", "simulated"]],
  },
] as const;

export function ConnectionForm({ view, initial, envStatus, inboundUrl, connectionId, onCreated }: Props) {
  const router = useRouter();
  const init = initial ?? {
    name: "UNIKLIFE.AI",
    connection_type: view ?? "both" as const,
    is_enabled: true,
    destination_url: null,
    auth_type: "hmac" as const,
    inbound_auth_type: "hmac" as const,
    outbound_auth_header_name: "X-API-Key",
    inbound_auth_header_name: "X-API-Key",
    outbound_secret_env: "UNIKLIFE_OUTBOUND_SECRET",
    inbound_secret_env: "UNIKLIFE_WEBHOOK_SECRET",
    event_mappings: {},
  };
  const [v, setV] = useState({
    connection_type: init.connection_type,
    name: init.name,
    is_enabled: init.is_enabled,
    destination_url: init.destination_url ?? "",
    auth_type: init.auth_type,
    inbound_auth_type: init.inbound_auth_type,
    outbound_auth_header_name: init.outbound_auth_header_name,
    inbound_auth_header_name: init.inbound_auth_header_name,
    outbound_secret_env: init.outbound_secret_env ?? "",
    inbound_secret_env: init.inbound_secret_env ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [internalTab, setActiveTab] = useState<"api" | "webhook">("api");
  const activeTab = view ?? internalTab;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const savedOut = !!initial && (initial.outbound_secret_env ?? "") === v.outbound_secret_env;
  const savedIn = !!initial && (initial.inbound_secret_env ?? "") === v.inbound_secret_env;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const event_mappings = Object.fromEntries(
      Object.entries(init.event_mappings).filter(([, value]) => typeof value === "string" || typeof value === "number"),
    );
    try {
      await api("/api/integrations/uniklife", { method: connectionId ? "PATCH" : "POST", body: { ...v, connection_id: connectionId ?? undefined, event_mappings } });
      setMsg({ ok: true, text: "Settings saved." });
      onCreated?.();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (selected: boolean) =>
    `border-b-2 px-4 py-2 text-sm font-bold ${selected ? "border-gold text-text" : "border-transparent text-muted"}`;

  return (
    <form onSubmit={save} className="space-y-5 p-5">
      {!view && <div role="tablist" aria-label="Integration settings" className="flex gap-2 border-b border-border">
        <button id="integration-tab-api" type="button" role="tab" aria-selected={activeTab === "api"} aria-controls="integration-panel-api"
          onClick={() => setActiveTab("api")} className={tabClass(activeTab === "api")}>API</button>
        <button id="integration-tab-webhook" type="button" role="tab" aria-selected={activeTab === "webhook"} aria-controls="integration-panel-webhook"
          onClick={() => setActiveTab("webhook")} className={tabClass(activeTab === "webhook")}>WEBHOOK</button>
      </div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Connection type" htmlFor="c-type">
            <select id="c-type" className="input" value={v.connection_type} onChange={(e) => setV({ ...v, connection_type: e.target.value as ConnectionFormValue["connection_type"] })}>
              <option value="api">API — send app data to CRM</option>
              <option value="webhook">Webhook — receive CRM updates</option>
              <option value="both">Both directions</option>
            </select>
          </Field>
          <Field label="Connection name" htmlFor="c-name">
            <input id="c-name" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required minLength={2} maxLength={80} />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
              <input type="checkbox" checked={v.is_enabled} onChange={(e) => setV({ ...v, is_enabled: e.target.checked })} />
              Enable connection
            </label>
          </div>
        </div>

      <section id="integration-panel-api" role="tabpanel" aria-label="API system and process" hidden={activeTab !== "api"} className="space-y-4">
        <p className="text-sm text-muted">Send app events to the CRM&apos;s Incoming Webhook.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {v.connection_type !== "webhook" && <div className="space-y-4 sm:col-span-2">
            <Field label="CRM Incoming Webhook URL" htmlFor="c-url" hint="Copy this URL from the CRM&apos;s Incoming Webhook trigger.">
              <input id="c-url" className="input" type="url" inputMode="url" placeholder="https://…" value={v.destination_url}
                onChange={(e) => setV({ ...v, destination_url: e.target.value })} maxLength={500} />
            </Field>
            <Field label="Authentication" htmlFor="c-auth">
              <select id="c-auth" className="input" value={v.auth_type} onChange={(e) => setV({ ...v, auth_type: e.target.value as ConnectionFormValue["auth_type"] })}>
                <AuthOptions />
              </select>
            </Field>
            {["api_key", "custom_header"].includes(v.auth_type) && <Field label="Authentication header name" htmlFor="c-out-header">
              <input id="c-out-header" className="input" value={v.outbound_auth_header_name} onChange={(e) => setV({ ...v, outbound_auth_header_name: e.target.value })} />
            </Field>}
            <Field label="Secret variable name" htmlFor="c-out" hint={<span className="inline-flex items-center gap-2">Set the secret value on the server. <EnvBadge set={envStatus?.outbound_secret_env} saved={savedOut} /></span>}>
              <input id="c-out" className="input font-mono" value={v.outbound_secret_env} pattern="[A-Z][A-Z0-9_]{2,63}" placeholder="UNIKLIFE_OUTBOUND_SECRET"
                onChange={(e) => setV({ ...v, outbound_secret_env: e.target.value.toUpperCase() })} />
            </Field>
          </div>}
        </div>

        <div>
          <h3 className="text-sm font-bold">Parameters available to connect</h3>
          <p className="mt-1 text-xs text-muted">Codes are exact JSON keys. Request details are top-level envelope fields; other values are under <code>data</code> and depend on event.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {API_PARAMETER_GROUPS.map((group) => (
              <section key={group.category} className="rounded-xl border border-border p-3">
                <h4 className="text-sm font-semibold">{group.category}</h4>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {group.parameters.map(([label, code]) => <li key={code} className="flex items-start justify-between gap-2"><span>{label}</span><CodeChip code={code} /></li>)}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section id="integration-panel-webhook" role="tabpanel" aria-label="Webhook settings" hidden={activeTab !== "webhook"} className="space-y-4">
        <p className="text-sm text-muted">Send CRM workflow updates into this app.</p>
        <div>
          <div className="label">App webhook URL</div>
          <CopyField value={inboundUrl} label="App webhook URL" />
        </div>
        {connectionId ? (
          <div>
            <div className="label">Connection ID — add as X-Uniklife-Connection in the CRM</div>
            <CopyField value={connectionId} label="Connection ID" />
          </div>
        ) : (
          <p className="rounded-lg bg-surface-strong p-3 text-sm text-muted">Save settings to generate your connection ID.</p>
        )}
        {v.connection_type !== "api" && <><Field label="Incoming authentication" htmlFor="c-in-auth">
          <select id="c-in-auth" className="input" value={v.inbound_auth_type} onChange={(e) => setV({ ...v, inbound_auth_type: e.target.value as ConnectionFormValue["inbound_auth_type"] })}>
            <AuthOptions />
          </select>
        </Field>
        {["api_key", "custom_header"].includes(v.inbound_auth_type) && <Field label="Incoming authentication header name" htmlFor="c-in-header">
          <input id="c-in-header" className="input" value={v.inbound_auth_header_name} onChange={(e) => setV({ ...v, inbound_auth_header_name: e.target.value })} />
        </Field>}
        <Field label="Secret variable name" htmlFor="c-in" hint={<span className="inline-flex items-center gap-2">Set its value on the server and in the CRM Auth tab. <EnvBadge set={envStatus?.inbound_secret_env} saved={savedIn} /></span>}>
          <input id="c-in" className="input font-mono" value={v.inbound_secret_env} pattern="[A-Z][A-Z0-9_]{2,63}" placeholder="UNIKLIFE_WEBHOOK_SECRET"
            onChange={(e) => setV({ ...v, inbound_secret_env: e.target.value.toUpperCase() })} />
        </Field></>}
        <p className="text-xs text-muted">In CRM, add an Outgoing Webhook action: POST JSON with Bearer authentication. HMAC is also supported.</p>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Body format</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-strong p-3 text-xs"><code>{`{
  "id": "unique-event-id",
  "type": "ping",
  "occurred_at": "2026-01-01T00:00:00.000Z",
  "data": {},
  "source": "uniklife-crm"
}`}</code></pre>
          <p className="mt-2 text-xs text-muted">Use a unique ID for each event. Begin with <code className="font-mono">ping</code> to test.</p>
        </details>
      </section>

      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : connectionId ? "Save settings" : "Create connection"}</Button>
    </form>
  );
}
