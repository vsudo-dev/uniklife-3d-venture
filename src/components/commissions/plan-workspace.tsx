"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Lock, PencilLine, Save, Send } from "lucide-react";
import { api } from "@/lib/client/api";
import {
  BASIS_LABEL, MAX_LEVELS, PLAN_PRESETS, RATE_DECIMALS, resizeLevels, suggestedLevels, validatePlanLevels,
  type CommissionBasis,
} from "@/lib/commissions/engine";
import { Badge, Button, Card, CardHeader, Notice, StatusBadge, cx } from "@/components/ui";
import { Simulator } from "./simulator";
import { NewVersionButton } from "./new-version-button";
import { METHOD_HELP, PROPERTY_TYPE_OPTIONS, fmtRate, type PlanDraft, type PlanSummary, type VentureOption } from "./types";

export interface WorkspacePlan extends PlanDraft {
  id: string;
  version: number;
  status: string;
  submittedBy: string | null;
  scopeLabel: string;
}

const LEVEL_COUNTS = Array.from({ length: MAX_LEVELS }, (_, i) => i + 1);

/** Value earned by each level in a complete LN→L1 chain under the chosen method (basis units). */
function fullChainShare(levels: PlanDraft["levels"], method: PlanDraft["calculationMethod"], basis: CommissionBasis) {
  const scale = 10 ** RATE_DECIMALS[basis];
  const sorted = [...levels].sort((a, b) => b.level - a.level); // lowest rank first
  let baseline = 0;
  const out = new Map<number, number>();
  for (const l of sorted) {
    if (!l.eligible || !Number.isFinite(l.rate)) { out.set(l.level, 0); continue; }
    const r = Math.round(l.rate * scale);
    const pay = method === "differential" ? Math.max(0, r - baseline) : r;
    out.set(l.level, pay / scale);
    if (method === "differential") baseline = Math.max(baseline, r);
  }
  return out;
}

export function PlanWorkspace({
  plan, plans, ventures, canApprove, currentUserId, requiresSecondApprover,
}: {
  plan: WorkspacePlan;
  plans: PlanSummary[];
  ventures: VentureOption[];
  canApprove: boolean;
  currentUserId: string;
  requiresSecondApprover: boolean;
}) {
  const router = useRouter();
  const editable = plan.status === "draft";
  const initial: PlanDraft = {
    name: plan.name, calculationMethod: plan.calculationMethod, paySellingEmployee: plan.paySellingEmployee,
    ceoSeparateEntitlement: plan.ceoSeparateEntitlement, maxPayableLevels: plan.maxPayableLevels, notes: plan.notes,
    levelCount: plan.levelCount, basis: plan.basis, propertyType: plan.propertyType, ventureIds: [...plan.ventureIds].sort(),
    levels: [...plan.levels].sort((a, b) => a.level - b.level),
  };
  const [draft, setDraft] = useState<PlanDraft>(initial);
  const [rateText, setRateText] = useState<string[]>(initial.levels.map((l) => String(l.rate)));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [preset, setPreset] = useState("");

  const pct = draft.basis === "percentage";
  const unit = pct ? "% of sale value" : "₹ per sq yd";
  const validation = useMemo(
    () => validatePlanLevels(draft.levels, { levelCount: draft.levelCount, basis: draft.basis }),
    [draft.levels, draft.levelCount, draft.basis],
  );
  const capOk = draft.maxPayableLevels <= draft.levelCount;
  const rowError = (i: number) => {
    const l = draft.levels[i];
    if (!Number.isFinite(l.rate) || l.rate < 0) return pct ? "Enter a non-negative percentage" : "Enter a non-negative rate";
    if (pct && l.rate > 100) return "Cannot exceed 100%";
    if (i > 0 && !(l.rate < draft.levels[i - 1].rate)) return `Must be lower than Level ${i} (${fmtRate(draft.basis, draft.levels[i - 1].rate)})`;
    return null;
  };
  const shares = fullChainShare(draft.levels, draft.calculationMethod, draft.basis);
  const chainTotal = [...shares.values()].reduce((s, x) => s + x, 0);
  const nameOk = draft.name.trim().length >= 2;
  const formOk = validation.ok && nameOk && capOk;

  function patch(p: Partial<PlanDraft>) {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  }
  function patchLevel(i: number, p: Partial<PlanDraft["levels"][number]>) {
    setDraft((d) => ({ ...d, levels: d.levels.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
    setDirty(true);
  }
  function setLevels(levels: PlanDraft["levels"], extra: Partial<PlanDraft> = {}) {
    setDraft((d) => {
      const levelCount = levels.length;
      return { ...d, ...extra, levels, levelCount, maxPayableLevels: Math.min(extra.maxPayableLevels ?? d.maxPayableLevels, levelCount) };
    });
    setRateText(levels.map((l) => String(l.rate)));
    setDirty(true);
  }
  function changeLevelCount(n: number) {
    const grew = n > draft.levelCount;
    const levels = resizeLevels(draft.levels, n, draft.basis);
    // When adding levels, let every level up to the new count be paid by default.
    setLevels(levels, grew && draft.maxPayableLevels === draft.levelCount ? { maxPayableLevels: n } : {});
  }
  function changeBasis(basis: CommissionBasis) {
    if (basis === draft.basis) return;
    // Values are not comparable across bases: start from a suggested descending series, keep labels/eligibility.
    const suggested = suggestedLevels(basis, draft.levelCount).map((s, i) => ({ ...s, label: draft.levels[i]?.label ?? s.label, eligible: draft.levels[i]?.eligible ?? true }));
    setLevels(suggested, { basis });
  }
  function applyPreset(id: string) {
    const p = PLAN_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setLevels(p.levels.map((l) => ({ ...l, eligible: true })), { basis: p.basis, maxPayableLevels: p.levels.length });
    setPreset("");
  }
  function toggleVenture(id: string, on: boolean) {
    const set = new Set(draft.ventureIds);
    if (on) set.add(id);
    else set.delete(id);
    patch({ ventureIds: [...set].sort() });
  }

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const payload = (): PlanDraft => ({ ...draft, name: draft.name.trim(), notes: draft.notes?.trim() || null });
  const save = () => api(`/api/commissions/plans/${plan.id}`, { method: "PUT", body: payload() }).then(() => setDirty(false));
  const isSubmitter = plan.submittedBy === currentUserId;
  const ventureName = (id: string) => ventures.find((v) => v.id === id)?.name ?? "Unknown venture";

  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card className="overflow-hidden">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Version {plan.version} <StatusBadge status={plan.status} />
              {!editable && <Badge tone="neutral"><Lock size={12} aria-hidden /> read-only</Badge>}
            </span>
          }
          subtitle={
            editable
              ? "Draft — edit freely, then submit for approval. Nothing applies to bookings until a version is approved."
              : "Approved and rejected versions are immutable. “Edit plan” creates a new draft version prefilled from this one (same scope)."
          }
          action={!editable ? <NewVersionButton fromPlanId={plan.id} label="Edit plan (new version)" /> : undefined}
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-5 py-2 text-xs text-muted">
          <Badge tone="gold">{draft.levelCount} level{draft.levelCount === 1 ? "" : "s"}</Badge>
          <Badge tone="neutral">{BASIS_LABEL[draft.basis]}</Badge>
          <span>
            Applies to: <strong className="text-text">{draft.ventureIds.length === 0 ? "All ventures" : draft.ventureIds.map(ventureName).join(", ")}</strong>
            {" · "}
            <strong className="text-text">{PROPERTY_TYPE_OPTIONS.find((o) => o.id === draft.propertyType)?.label ?? draft.propertyType}</strong>
          </span>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="plan-name">Plan name</label>
              <input id="plan-name" className="input" disabled={!editable} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              {!nameOk && <p className="mt-1 text-xs text-danger">Name must be at least 2 characters</p>}
            </div>

            <fieldset>
              <legend className="label">Commission basis</legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1" role="radiogroup" aria-label="Commission basis">
                {(["per_sq_yard", "percentage"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={draft.basis === b}
                    disabled={!editable}
                    onClick={() => changeBasis(b)}
                    className={cx(
                      "rounded-lg px-2 py-2 text-sm font-semibold transition disabled:cursor-default",
                      draft.basis === b ? "bg-surface text-text shadow-sm ring-1 ring-gold/40" : "text-muted",
                    )}
                  >
                    {b === "per_sq_yard" ? "₹ per sq yd" : "% of sale value"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">
                {pct
                  ? "Each level earns a percentage of the booking's net sale value (after discounts; total of all plots). Typical for villas / plots with construction and apartments."
                  : "Each level earns a fixed ₹ amount per square yard sold. Typical for open plots."}
              </p>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="plan-property-type">Property type</label>
                <select id="plan-property-type" className="input" disabled={!editable} value={draft.propertyType} onChange={(e) => patch({ propertyType: e.target.value })}>
                  {PROPERTY_TYPE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="plan-level-count">Number of levels</label>
                <select id="plan-level-count" className="input" disabled={!editable} value={draft.levelCount} onChange={(e) => changeLevelCount(Number(e.target.value))}>
                  {LEVEL_COUNTS.map((n) => <option key={n} value={n}>{n} level{n === 1 ? "" : "s"}</option>)}
                </select>
              </div>
            </div>

            <fieldset>
              <legend className="label">Ventures</legend>
              <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-border p-2">
                <label className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" disabled={!editable} checked={draft.ventureIds.length === 0} onChange={(e) => e.target.checked && patch({ ventureIds: [] })} />
                  <strong>All ventures</strong>
                  <span className="text-xs text-muted">(organization-wide)</span>
                </label>
                {ventures.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" disabled={!editable} checked={draft.ventureIds.includes(v.id)} onChange={(e) => toggleVenture(v.id, e.target.checked)} />
                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                    <span className="text-xs text-muted">{PROPERTY_TYPE_OPTIONS.find((o) => o.id === v.propertyType)?.label ?? v.propertyType}</span>
                  </label>
                ))}
                {ventures.length === 0 && <p className="px-2 py-1 text-xs text-muted">No ventures yet.</p>}
              </div>
              <p className="mt-1 text-xs text-muted">
                For each sale the most specific approved plan applies: venture + property type, then venture, then property type, then the organization-wide plan.
              </p>
            </fieldset>

            <fieldset>
              <legend className="label">Calculation method</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["differential", "full_rate"] as const).map((m) => (
                  <label
                    key={m}
                    className={cx(
                      "cursor-pointer rounded-xl border p-3 text-sm transition",
                      draft.calculationMethod === m ? "border-gold bg-gold-soft/40 shadow-[var(--glow)]" : "border-border hover:border-gold/60",
                      !editable && "cursor-default",
                    )}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      <input type="radio" name="method" value={m} disabled={!editable} checked={draft.calculationMethod === m} onChange={() => patch({ calculationMethod: m })} className="accent-[var(--gold)]" />
                      {METHOD_HELP[m].title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{METHOD_HELP[m].body}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--gold)]" disabled={!editable} checked={draft.paySellingEmployee} onChange={(e) => patch({ paySellingEmployee: e.target.checked })} />
              <span><strong>Pay the selling employee</strong><span className="block text-xs text-muted">When off, the seller earns nothing and the first eligible upline is paid from zero.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--gold)]" disabled={!editable} checked={draft.ceoSeparateEntitlement} onChange={(e) => patch({ ceoSeparateEntitlement: e.target.checked })} />
              <span><strong>CEO separate entitlement</strong><span className="block text-xs text-muted">The Level 1 (CEO) value is paid in full on every sale, in addition to the chain payouts, instead of as a differential.</span></span>
            </label>
            <div>
              <label className="label" htmlFor="max-levels">Maximum payable levels per sale</label>
              <select id="max-levels" className="input" disabled={!editable} value={draft.maxPayableLevels} onChange={(e) => patch({ maxPayableLevels: Number(e.target.value) })}>
                {LEVEL_COUNTS.filter((n) => n <= draft.levelCount).map((n) => <option key={n} value={n}>{n} {n === 1 ? "person" : "people"}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">Counts paid people from the seller upward (at most the number of levels); anyone beyond the cap earns nothing on that sale.</p>
              {!capOk && <p className="mt-1 text-xs text-danger">Cannot exceed the number of levels ({draft.levelCount})</p>}
            </div>
            <div>
              <label className="label" htmlFor="plan-notes">Notes</label>
              <textarea id="plan-notes" className="input" rows={3} disabled={!editable} value={draft.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
            </div>
            <div className="flex gap-2 rounded-xl border border-gold/40 bg-gold-soft/30 p-3 text-xs leading-relaxed text-muted">
              <Info size={14} className="mt-0.5 shrink-0 text-gold-strong" aria-hidden />
              <span>
                Employees whose commission level is above this plan&apos;s level count (e.g. an L7 under a 5-level plan) are not on this plan&apos;s ladder
                and earn nothing from it. Approved versions can never be edited — changing the levels, rates, basis or scope always creates a new version
                that applies only to bookings confirmed after it is approved.
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="font-bold">{draft.levelCount}-level rates ({unit})</h3>
              <p className="text-xs text-muted">
                Values must strictly descend: L1 &gt; L2 &gt; … &gt; L{draft.levelCount}.{" "}
                {pct ? "Up to 4 decimals, at most 100%." : "Up to 2 decimals."}
              </p>
            </div>
            {editable && (
              <div className="sm:w-64">
                <label className="label" htmlFor="plan-preset">Start from a preset</label>
                <select id="plan-preset" className="input" value={preset} onChange={(e) => applyPreset(e.target.value)}>
                  <option value="">Choose a preset…</option>
                  {PLAN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Level</th><th>Label</th><th>{pct ? "% of sale value" : "₹ / sq yd"}</th><th>Eligible</th>
                  <th className="text-right">Earns in a full chain</th>
                </tr>
              </thead>
              <tbody>
                {draft.levels.map((l, i) => {
                  const err = editable ? rowError(i) : null;
                  return (
                    <tr key={l.level} className={err ? "bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]" : undefined}>
                      <td className="whitespace-nowrap">
                        <span className="rounded-md bg-primary-strong px-2 py-0.5 text-xs font-bold text-white">L{l.level}</span>
                      </td>
                      <td className="min-w-[170px]">
                        <input aria-label={`Level ${l.level} label`} className="input" disabled={!editable} value={l.label} onChange={(e) => patchLevel(i, { label: e.target.value })} />
                      </td>
                      <td className="min-w-[140px]">
                        <div className="relative">
                          {!pct && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>₹</span>}
                          <input
                            aria-label={pct ? `Level ${l.level} percentage of sale value` : `Level ${l.level} rate per sq yd`}
                            aria-invalid={!!err}
                            inputMode="decimal"
                            className={cx("input tabular-nums", !pct && "pl-7", pct && "pr-8", err && "border-danger")}
                            disabled={!editable}
                            value={rateText[i] ?? ""}
                            onChange={(e) => {
                              const t = e.target.value;
                              setRateText((r) => r.map((x, j) => (j === i ? t : x)));
                              patchLevel(i, { rate: t.trim() === "" ? NaN : Number(t) });
                            }}
                          />
                          {pct && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>%</span>}
                        </div>
                        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
                      </td>
                      <td>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" disabled={!editable} checked={l.eligible} onChange={(e) => patchLevel(i, { eligible: e.target.checked })} />
                          {l.eligible ? "Yes" : "No"}
                        </label>
                      </td>
                      <td className="text-right tabular-nums">{fmtRate(draft.basis, shares.get(l.level) ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="border-t border-border px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">
                    Full L{draft.levelCount} → L1 chain, {draft.calculationMethod === "differential" ? "differential" : "full rate"} (before caps / CEO entitlement)
                  </td>
                  <td className="border-t border-border px-3 py-3 text-right font-extrabold tabular-nums">{fmtRate(draft.basis, Math.round(chainTotal * 10000) / 10000)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && !validation.ok && (
            <div className="px-5 pb-4 pt-2">
              <Notice tone="danger" title="Fix these before saving">
                <ul className="list-disc pl-5">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </Notice>
            </div>
          )}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-5 py-4">
            <Button variant="outline" disabled={!!busy || !formOk || !dirty} onClick={() => run("save", save, "Draft saved")}>
              <Save size={16} aria-hidden /> {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              variant="gold"
              disabled={!!busy || !formOk}
              onClick={() =>
                run("submit", async () => {
                  if (dirty) await save();
                  await api(`/api/commissions/plans/${plan.id}/submit`, { body: {} });
                }, "Submitted for approval")
              }
            >
              <Send size={16} aria-hidden /> {busy === "submit" ? "Submitting…" : "Submit for approval"}
            </Button>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
          </div>
        )}
        {!editable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-5 py-3 text-xs text-muted">
            <PencilLine size={14} aria-hidden /> To change this structure, use <strong className="text-text">Edit plan (new version)</strong> — the new draft keeps this scope
            and can be approved from a future effective date. Ledger entries already calculated with v{plan.version} are never changed.
          </div>
        )}
      </Card>

      {plan.status === "pending_approval" && (
        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-bold"><CheckCircle2 size={18} className="text-gold" aria-hidden /> Approval decision</h3>
          {!canApprove ? (
            <p className="mt-2 text-sm text-muted">Awaiting approval by a user with commission approval rights.</p>
          ) : isSubmitter && requiresSecondApprover ? (
            <div className="mt-3"><Notice tone="warning" title="Another approver is required">You submitted this version. Your organization requires commission plans to be approved by someone other than the submitter.</Notice></div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
              {isSubmitter && (
                <div className="md:col-span-2">
                  <Notice tone="gold" title="Single-approver mode">You submitted this version. Your organization allows self-approval; it will be recorded as such in the approval history and audit log.</Notice>
                </div>
              )}
              <div>
                <label className="label" htmlFor="eff-from">Effective from</label>
                <input id="eff-from" type="datetime-local" className="input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                <p className="mt-1 text-xs text-muted">Leave blank for immediately. Cannot be in the past.</p>
              </div>
              <div>
                <label className="label" htmlFor="decision-note">Note (required to reject)</label>
                <textarea id="decision-note" className="input" rows={2} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  variant="gold"
                  disabled={!!busy}
                  onClick={() =>
                    run("approve", () =>
                      api(`/api/commissions/plans/${plan.id}/approve`, {
                        body: { effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null, note: decisionNote.trim() || undefined },
                      }), "Plan approved — it applies to bookings in its scope confirmed from the effective date")
                  }
                >
                  Approve &amp; activate
                </Button>
                <Button variant="outline" className="text-danger" disabled={!!busy || decisionNote.trim().length < 5} onClick={() => run("reject", () => api(`/api/commissions/plans/${plan.id}/reject`, { body: { note: decisionNote.trim() } }), "Plan rejected")}>
                  Reject
                </Button>
              </div>
              <p className="flex items-start gap-2 text-xs text-muted md:col-span-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                Approving closes the currently open plan of the same scope ({plan.scopeLabel}) at the effective date; plans for other ventures or property
                types are not affected. Existing ledger entries keep the plan version they were calculated with — history is never rewritten.
              </p>
            </div>
          )}
        </Card>
      )}

      <Simulator plans={plans} draft={editable && formOk ? payload() : null} draftLabel={`v${plan.version} draft (including unsaved edits)`} defaultPlanId={plan.id} />
    </div>
  );
}
