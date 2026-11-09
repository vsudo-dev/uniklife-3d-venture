"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Info, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Notice, cx } from "@/components/ui";
import type { Category, DiscountFormValues } from "./discount-values";

interface Policy {
  errors: string[];
  requiresApproval: boolean;
  reasons: string[];
  resultingStatus?: string;
}

const CATEGORY_HELP: Record<Category, string> = {
  general: "Applies to any eligible booking (optionally restricted to ventures).",
  coupon: "Only applied when the customer or staff enters the code. Codes are never listed publicly.",
  venture: "Applies to plots in the selected venture(s).",
  plot: "Applies only to the selected plots; in multi-plot bookings only eligible plots are discounted.",
  promotional: "Time-limited offer — an expiry date is required.",
  campaign: "Tied to a marketing campaign for reporting.",
  customer: "Usable only by one specific customer.",
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "general", label: "General" },
  { value: "coupon", label: "Coupon code" },
  { value: "venture", label: "Venture-specific" },
  { value: "plot", label: "Plot-specific" },
  { value: "promotional", label: "Time-limited promotion" },
  { value: "campaign", label: "Campaign" },
  { value: "customer", label: "Customer-specific" },
];

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildBody(v: DiscountFormValues, forPreview = false) {
  const usesVentures = v.category !== "plot" && v.category !== "customer";
  return {
    name: v.name.trim() || (forPreview ? "Preview" : ""),
    code: v.code.trim() || null,
    valueType: v.valueType,
    category: v.category,
    value: v.value === "" ? (forPreview ? 0.01 : v.value) : Number(v.value),
    maxDiscountAmount: v.maxDiscountAmount === "" ? null : Number(v.maxDiscountAmount),
    startsAt: toIso(v.startsAt),
    expiresAt: toIso(v.expiresAt),
    applicableVentureIds: usesVentures ? v.applicableVentureIds : [],
    applicablePlotIds: v.category === "plot" ? v.applicablePlotIds : [],
    customerId: v.category === "customer" ? v.customerId : null,
    campaignName: v.category === "campaign" ? v.campaignName.trim() || null : null,
    usageLimitTotal: v.usageLimitTotal === "" ? null : Number(v.usageLimitTotal),
    usageLimitPerCustomer: v.usageLimitPerCustomer === "" ? null : Number(v.usageLimitPerCustomer),
    stackable: v.stackable,
    requiresApproval: v.requiresApproval,
  };
}

function errorText(e: unknown): string[] {
  const err = e as ApiError;
  if (Array.isArray(err.details)) {
    const list = (err.details as unknown[]).map((d) => (typeof d === "string" ? d : (d as { path?: string; message?: string }).path ? `${(d as { path: string }).path}: ${(d as { message: string }).message}` : String((d as { message?: string }).message ?? d)));
    if (list.length) return list;
  }
  return [err.message];
}

export function DiscountForm({
  mode,
  discountId,
  initial,
  initialPlotVentureId,
  settings,
  canSelfApprove,
}: {
  mode: "create" | "edit";
  discountId?: string;
  initial: DiscountFormValues;
  initialPlotVentureId?: string | null;
  settings: { allowStacking: boolean; maxDiscountPercent: number; approvalThresholdPercent: number };
  canSelfApprove: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountFormValues>(initial);
  const [ventures, setVentures] = useState<{ id: string; name: string; code: string }[]>([]);
  const [plotVenture, setPlotVenture] = useState<string>(initialPlotVentureId ?? "");
  const [plots, setPlots] = useState<{ id: string; plot_number: string; status: string }[]>([]);
  const [plotFilter, setPlotFilter] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  const [preview, setPreview] = useState<Policy | null>(null);
  const [result, setResult] = useState<{ policy: Policy; id: string; status: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const previewSeq = useRef(0);

  const set = <K extends keyof DiscountFormValues>(k: K, val: DiscountFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  useEffect(() => {
    api<{ ventures: { id: string; name: string; code: string }[] }>("/api/discounts/options").then((r) => setVentures(r.ventures)).catch(() => setVentures([]));
  }, []);

  useEffect(() => {
    if (!plotVenture) return setPlots([]);
    api<{ plots: { id: string; plot_number: string; status: string }[] }>(`/api/discounts/options?venture=${plotVenture}`).then((r) => setPlots(r.plots)).catch(() => setPlots([]));
  }, [plotVenture]);

  useEffect(() => {
    if (v.category !== "customer" || custQuery.trim().length < 2) return setCustResults([]);
    const t = window.setTimeout(() => api<{ id: string; full_name: string; phone: string | null }[]>(`/api/customers/search?q=${encodeURIComponent(custQuery)}`).then(setCustResults).catch(() => setCustResults([])), 250);
    return () => window.clearTimeout(t);
  }, [custQuery, v.category]);

  // Live server policy preview (debounced). The server re-evaluates on save.
  const previewKey = JSON.stringify([v.valueType, v.category, v.value, v.maxDiscountAmount, v.requiresApproval, v.stackable, v.code, v.expiresAt, v.startsAt, v.campaignName, v.customerId, v.applicableVentureIds.length, v.applicablePlotIds.length]);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const t = window.setTimeout(() => {
      api<Policy>("/api/discounts/policy", { body: buildBody(v, true) })
        .then((p) => seq === previewSeq.current && setPreview(p))
        .catch((e) => seq === previewSeq.current && setPreview({ errors: errorText(e), requiresApproval: false, reasons: [] }));
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const filteredPlots = useMemo(() => plots.filter((p) => !plotFilter || p.plot_number.toLowerCase().includes(plotFilter.toLowerCase())), [plots, plotFilter]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      const body = buildBody(v);
      const res = mode === "create"
        ? await api<{ discount: { id: string; status: string }; policy: Policy }>("/api/discounts", { body })
        : await api<{ discount: { id: string; status: string }; policy: Policy }>(`/api/discounts/${discountId}`, { method: "PUT", body });
      setResult({ policy: res.policy, id: res.discount.id, status: res.discount.status });
      router.refresh();
    } catch (err) {
      setErrors(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const isPct = v.valueType === "percentage";

  if (result) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{mode === "create" ? "Discount created" : "Discount updated"}</h2>
            <p className="mt-1 text-sm text-muted">
              Server decision: <strong className={result.status === "active" ? "text-success" : "text-warning"}>{result.status.replace(/_/g, " ")}</strong>
              {result.policy.requiresApproval ? " — a second person holding discount approval rights must approve it before it can be used." : " — it can be used immediately."}
            </p>
            {result.policy.reasons.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{result.policy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/discounts/${result.id}`} className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast">View discount</Link>
              <Link href="/discounts" className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-gold">Back to discounts</Link>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        {errors.length > 0 && (
          <Notice tone="danger" title="The server rejected this discount">
            <ul className="list-disc pl-5">{errors.map((x) => <li key={x}>{x}</li>)}</ul>
          </Notice>
        )}

        <Card className="space-y-4 p-5">
          <h2 className="font-bold">Basics</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="d-name">Name</label>
              <input id="d-name" className="input" required minLength={2} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Launch offer 5%" />
            </div>
            <div className="sm:col-span-2">
              <span className="label">Category</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
                {CATEGORIES.map((c) => (
                  <button type="button" key={c.value} role="radio" aria-checked={v.category === c.value} onClick={() => set("category", c.value)}
                    className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold transition", v.category === c.value ? "border-gold bg-gold-soft text-gold-strong" : "border-border hover:border-gold")}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{CATEGORY_HELP[v.category]}</p>
            </div>
            <div>
              <label className="label" htmlFor="d-code">{v.category === "coupon" ? "Coupon code (required)" : "Code (optional)"}</label>
              <input id="d-code" className="input font-mono uppercase" value={v.code} required={v.category === "coupon"} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="LAUNCH5" maxLength={32} />
              <p className="mt-1 text-xs text-muted">{v.category === "coupon" ? "3–32 chars: A–Z, 0–9, _ or -." : "With a code, the discount is only applied when the code is entered; without one it is offered automatically to eligible bookings."}</p>
            </div>
            {v.category === "campaign" && (
              <div>
                <label className="label" htmlFor="d-campaign">Campaign name</label>
                <input id="d-campaign" className="input" required value={v.campaignName} onChange={(e) => set("campaignName", e.target.value)} maxLength={120} placeholder="e.g. Diwali 2026" />
              </div>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-bold">Value</h2>
          <div className="flex gap-2">
            {(["percentage", "fixed_amount"] as const).map((t) => (
              <button type="button" key={t} onClick={() => set("valueType", t)} aria-pressed={v.valueType === t}
                className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", v.valueType === t ? "bg-primary text-primary-contrast" : "bg-surface-2")}>
                {t === "percentage" ? "Percentage (%)" : "Fixed amount (₹)"}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="d-value">{isPct ? "Discount %" : "Discount amount (₹)"}</label>
              <input id="d-value" className="input" required inputMode="decimal" type="number" step="0.01" min="0.01" max={isPct ? 100 : undefined} value={v.value} onChange={(e) => set("value", e.target.value)} />
              {isPct && <p className="mt-1 text-xs text-muted">Organization limit {settings.maxDiscountPercent}% · approval above {settings.approvalThresholdPercent}%</p>}
            </div>
            <div>
              <label className="label" htmlFor="d-cap">Maximum discount (₹, optional)</label>
              <input id="d-cap" className="input" inputMode="decimal" type="number" step="0.01" min="0.01" value={v.maxDiscountAmount} onChange={(e) => set("maxDiscountAmount", e.target.value)} />
              <p className="mt-1 text-xs text-muted">Caps the total discount per booking.</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-bold">Applicability</h2>
          {v.category !== "plot" && v.category !== "customer" && (
            <div>
              <span className="label">{v.category === "venture" ? "Ventures (select at least one)" : "Restrict to ventures (optional)"}</span>
              {ventures.length === 0 ? (
                <p className="text-sm text-muted">No ventures yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ventures.map((x) => (
                    <label key={x.id} className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm", v.applicableVentureIds.includes(x.id) ? "border-gold bg-gold-soft" : "border-border")}>
                      <input type="checkbox" checked={v.applicableVentureIds.includes(x.id)} onChange={() => set("applicableVentureIds", toggle(v.applicableVentureIds, x.id))} />
                      {x.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {v.category === "plot" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="d-pv">Venture</label>
                  <select id="d-pv" className="input" value={plotVenture} onChange={(e) => setPlotVenture(e.target.value)}>
                    <option value="">Select a venture…</option>
                    {ventures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="d-pf">Find plot</label>
                  <input id="d-pf" className="input" value={plotFilter} onChange={(e) => setPlotFilter(e.target.value)} placeholder="Plot number" disabled={!plotVenture} />
                </div>
              </div>
              {plotVenture && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-border p-2">
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {filteredPlots.map((p) => (
                      <button type="button" key={p.id} onClick={() => set("applicablePlotIds", toggle(v.applicablePlotIds, p.id))} aria-pressed={v.applicablePlotIds.includes(p.id)}
                        className={cx("rounded-lg border px-2 py-1.5 text-xs font-semibold", v.applicablePlotIds.includes(p.id) ? "border-gold bg-gold text-[#1b1400]" : "border-border hover:border-gold")}
                        title={p.status}>
                        {p.plot_number}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">{v.applicablePlotIds.length} plot(s) selected.</p>
            </div>
          )}

          {v.category === "customer" && (
            <div>
              <span className="label">Customer</span>
              {v.customerId ? (
                <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  <strong>{v.customerLabel ?? v.customerId}</strong>
                  <button type="button" className="font-semibold text-primary" onClick={() => setV((s) => ({ ...s, customerId: null, customerLabel: null }))}>Change</button>
                </div>
              ) : (
                <>
                  <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by name or phone" value={custQuery} onChange={(e) => setCustQuery(e.target.value)} aria-label="Search customers" /></div>
                  <ul className="mt-2 divide-y divide-border">
                    {custResults.map((c) => (
                      <li key={c.id}><button type="button" className="w-full px-2 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setV((s) => ({ ...s, customerId: c.id, customerLabel: `${c.full_name}${c.phone ? ` · ${c.phone}` : ""}` }))}><strong>{c.full_name}</strong> <span className="text-muted">{c.phone}</span></button></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="d-start">Valid from (optional)</label>
              <input id="d-start" type="datetime-local" className="input" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              <p className="mt-1 text-xs text-muted">Defaults to now.</p>
            </div>
            <div>
              <label className="label" htmlFor="d-exp">{v.category === "promotional" ? "Expires (required)" : "Expires (optional)"}</label>
              <input id="d-exp" type="datetime-local" className="input" required={v.category === "promotional"} value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="d-ult">Total usage limit</label>
              <input id="d-ult" type="number" min="1" step="1" className="input" value={v.usageLimitTotal} onChange={(e) => set("usageLimitTotal", e.target.value)} placeholder="Unlimited" />
            </div>
            <div>
              <label className="label" htmlFor="d-ulc">Per-customer limit</label>
              <input id="d-ulc" type="number" min="1" step="1" className="input" value={v.usageLimitPerCustomer} onChange={(e) => set("usageLimitPerCustomer", e.target.value)} placeholder="Unlimited" />
            </div>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-bold">Controls</h2>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={v.stackable} onChange={(e) => set("stackable", e.target.checked)} />
            <span><strong>Stackable</strong> — may combine with other stackable discounts.
              <span className="mt-0.5 block text-xs text-muted">
                Stacking is {settings.allowStacking ? "enabled" : "disabled"} for this organization{settings.allowStacking ? "" : " (default). Only one discount applies per booking until an administrator enables stacking in Settings"}. When enabled, every discount on a booking must be stackable.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={v.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} />
            <span><strong>Always require approval</strong>
              <span className="mt-0.5 block text-xs text-muted">{canSelfApprove ? "Your role can activate discounts within the approval threshold without a second approver." : "Your role always requires a second approver."}</span>
            </span>
          </label>
        </Card>
      </div>

      <aside>
        <Card className="sticky top-24 space-y-4 p-5 shadow-[var(--glow)]">
          <h2 className="flex items-center gap-2 font-bold"><ShieldAlert size={18} className="text-gold" />Server policy check</h2>
          {!preview ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Checking…</div>
          ) : (
            <div className="space-y-3 text-sm">
              {preview.errors.length > 0 ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3">
                  <div className="mb-1 flex items-center gap-1.5 font-bold text-danger"><X size={14} />Cannot be saved</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">{preview.errors.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ) : (
                <div className={cx("rounded-xl p-3", preview.requiresApproval ? "bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]" : "bg-[color-mix(in_srgb,var(--success)_10%,transparent)]")}>
                  <div className={cx("font-bold", preview.requiresApproval ? "text-warning" : "text-success")}>
                    {preview.requiresApproval ? "Will require approval" : "Will be active immediately"}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{preview.requiresApproval ? "Saved as pending approval; a different approver must approve it (four-eyes rule)." : "Within your authority and the organization limits."}</p>
                </div>
              )}
              {preview.reasons.length > 0 && (
                <ul className="space-y-1 text-xs">{preview.reasons.map((r) => <li key={r} className="flex gap-1.5"><Info size={12} className="mt-0.5 shrink-0 text-gold" />{r}</li>)}</ul>
              )}
            </div>
          )}
          <Button type="submit" variant="gold" className="w-full" disabled={busy || !!preview?.errors.length}>
            {busy && <Loader2 size={16} className="animate-spin" />}{mode === "create" ? "Create discount" : "Save changes"}
          </Button>
          <p className="text-[0.7rem] leading-relaxed text-muted">The final decision is made on the server when you save. Discounts are re-validated again when each booking&apos;s payment is confirmed.</p>
        </Card>
      </aside>
    </form>
  );
}
