"use client";

import { useEffect, useState } from "react";
import { Calculator, Minus, Plus, Search, UserRound } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Notice, cx } from "@/components/ui";
import { BASIS_LABEL, MAX_LEVELS, type CommissionBasis, type CommissionResult } from "@/lib/commissions/engine";
import { fmtInr, fmtRate, type PlanDraft, type PlanSummary } from "./types";

type Mode = "hypothetical" | "employee";
interface EmployeeHit { id: string; employee_code: string; full_name: string; designation: string | null }

const ROLE: Record<string, string> = { seller: "Seller", upline: "Upline", ceo_entitlement: "CEO entitlement" };
const LEVELS = Array.from({ length: MAX_LEVELS }, (_, i) => i + 1);
const fullChain = (n: number) => Array.from({ length: n }, (_, i) => n - i);

/**
 * Administrator simulator: run any saved plan version (or the unsaved draft) against
 * a real employee's current upline or a hypothetical chain, before activation.
 * Per-sq-yd plans ask for an area; percentage plans ask for a sale value.
 */
export function Simulator({ plans, draft, draftLabel, defaultPlanId }: { plans: PlanSummary[]; draft: PlanDraft | null; draftLabel?: string; defaultPlanId?: string }) {
  const [source, setSource] = useState<string>(
    draft ? "draft" : (defaultPlanId && plans.some((p) => p.id === defaultPlanId) ? defaultPlanId : plans.find((p) => p.status === "active")?.id ?? plans[0]?.id ?? ""),
  );
  const [area, setArea] = useState("200");
  const [saleValue, setSaleValue] = useState("5000000");
  const [mode, setMode] = useState<Mode>("hypothetical");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [employee, setEmployee] = useState<EmployeeHit | null>(null);
  const [result, setResult] = useState<CommissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = source === "draft" && draft ? { basis: draft.basis, levelCount: draft.levelCount } : plans.find((p) => p.id === source);
  const basis: CommissionBasis = selected?.basis ?? "per_sq_yard";
  const levelCount = selected?.levelCount ?? 8;
  const [chain, setChain] = useState<(number | null)[]>(fullChain(levelCount));

  useEffect(() => {
    if (!draft && source === "draft") setSource(plans[0]?.id ?? "");
  }, [draft, source, plans]);

  useEffect(() => {
    if (mode !== "employee" || term.trim().length < 2 || employee) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<EmployeeHit[]>(`/api/employees/search?q=${encodeURIComponent(term.trim())}`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term, mode, employee]);

  const presets: { label: string; levels: (number | null)[] }[] = [
    { label: `Full chain (L${levelCount} → L1)`, levels: fullChain(levelCount) },
    { label: "Ladder L8 → L1 (ranks beyond the plan are unpaid)", levels: fullChain(8) },
    { label: "Seller L5 under an L6 manager", levels: [5, 6, 4, 3, 2, 1] },
  ];

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = basis === "percentage" ? { saleValue: Number(saleValue) } : { areaSqYards: Number(area) };
      if (source === "draft" && draft) body.plan = draft;
      else body.planId = source;
      if (mode === "employee") {
        if (!employee) throw new Error("Choose an employee first");
        body.employeeId = employee.id;
      } else body.hypotheticalLevels = chain;
      setResult(await api<CommissionResult>("/api/commissions/simulate", { body }));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const measureOk = basis === "percentage" ? Number(saleValue) > 0 : Number(area) > 0;
  const lineFor = (employeeId: string, depth: number) => result?.lines.find((l) => l.employeeId === employeeId && l.chainDepth === depth && l.beneficiaryRole !== "ceo_entitlement");
  const rb: CommissionBasis = result?.basis ?? basis;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Calculator size={18} className="text-gold" aria-hidden /> Commission simulator</span>}
        subtitle="Preview who is paid, how much and why — nothing is written to the ledger."
      />
      <div className="grid gap-4 p-5 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="sim-plan">Plan</label>
          <select id="sim-plan" className="input" value={source} onChange={(e) => { setSource(e.target.value); setResult(null); }}>
            {draft && <option value="draft">{draftLabel ?? "Draft being edited (unsaved changes)"}</option>}
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                v{p.version} · {p.name} ({p.status.replace("_", " ")}) · {p.levelCount}L {p.basis === "percentage" ? "%" : "₹/sq yd"}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">{levelCount} levels · {BASIS_LABEL[basis]}</p>
        </div>
        {basis === "percentage" ? (
          <div>
            <label className="label" htmlFor="sim-sale">Sale value (₹, net of discounts)</label>
            <input id="sim-sale" className="input" inputMode="decimal" value={saleValue} onChange={(e) => setSaleValue(e.target.value)} />
            {!measureOk ? <p className="mt-1 text-xs text-danger">Enter a positive sale value</p> : <p className="mt-1 text-xs text-muted">{fmtInr(Number(saleValue))}</p>}
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="sim-area">Area (sq yd)</label>
            <input id="sim-area" className="input" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} />
            {!measureOk && <p className="mt-1 text-xs text-danger">Enter a positive area</p>}
          </div>
        )}
        <div>
          <span className="label">Chain</span>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1" role="radiogroup" aria-label="Chain source">
            {(["hypothetical", "employee"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cx("rounded-lg px-2 py-1.5 text-xs font-semibold transition", mode === m ? "bg-surface text-text shadow-sm ring-1 ring-gold/40" : "text-muted")}
              >
                {m === "hypothetical" ? "Hypothetical levels" : "Real employee"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-4">
        {mode === "hypothetical" ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">Presets:</span>
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => setChain(p.levels)} className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:border-gold">
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-xs text-muted">Seller first, then each reporting manager upward.</p>
            <ol className="flex flex-wrap items-center gap-2">
              {chain.map((lvl, i) => (
                <li key={i} className="flex items-center gap-1">
                  <div className={cx("rounded-xl border bg-surface px-2 py-1.5", lvl !== null && lvl > levelCount ? "border-warning" : "border-border")}>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">{i === 0 ? "Seller" : `Upline ${i}`}</div>
                    <select
                      aria-label={i === 0 ? "Seller level" : `Upline ${i} level`}
                      className="bg-transparent text-sm font-semibold outline-none"
                      value={lvl ?? ""}
                      onChange={(e) => setChain(chain.map((c, j) => (j === i ? (e.target.value ? Number(e.target.value) : null) : c)))}
                    >
                      {LEVELS.map((n) => <option key={n} value={n}>Level {n}{n > levelCount ? " (off plan)" : ""}</option>)}
                      <option value="">Off ladder</option>
                    </select>
                  </div>
                  {i < chain.length - 1 && <span className="text-muted" aria-hidden>→</span>}
                </li>
              ))}
              <li className="flex gap-1">
                <button type="button" aria-label="Add upline" disabled={chain.length >= 16} onClick={() => setChain([...chain, 1])} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:border-gold disabled:opacity-40"><Plus size={14} /></button>
                <button type="button" aria-label="Remove last upline" disabled={chain.length <= 1} onClick={() => setChain(chain.slice(0, -1))} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:border-gold disabled:opacity-40"><Minus size={14} /></button>
              </li>
            </ol>
          </div>
        ) : (
          <div className="max-w-md">
            <label className="label" htmlFor="sim-emp">Selling employee</label>
            {employee ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gold/50 bg-gold-soft/50 px-3 py-2">
                <span className="flex items-center gap-2 text-sm"><UserRound size={16} className="text-gold-strong" aria-hidden /><strong>{employee.employee_code}</strong> · {employee.full_name}</span>
                <button type="button" className="text-xs font-semibold text-primary" onClick={() => { setEmployee(null); setTerm(""); }}>Change</button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input id="sim-emp" className="input pl-9" placeholder="Search by name or Employee ID" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
                {hits.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setEmployee(h); setHits([]); }}>
                          <strong>{h.employee_code}</strong> · {h.full_name}
                          {h.designation && <span className="block text-xs text-muted">{h.designation}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-muted">Uses the employee&apos;s current reporting chain. Real bookings use the chain captured at booking time.</p>
          </div>
        )}
        <div className="mt-4">
          <Button variant="gold" disabled={busy || !measureOk || !source || (mode === "employee" && !employee)} onClick={run}>
            {busy ? "Calculating…" : "Run simulation"}
          </Button>
        </div>
      </div>

      {error && <div className="px-5 pb-4"><Notice tone="danger">{error}</Notice></div>}

      {result && (
        <div className="border-t border-border">
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
            <div className="rounded-xl border border-gold/40 bg-gold-soft/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Total payout</div>
              <div className="text-2xl font-extrabold tabular-nums">{fmtInr(result.totalAmount)}</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{rb === "percentage" ? "Of sale value" : "Per sq yd"}</div>
              <div className="text-2xl font-extrabold tabular-nums">
                {rb === "percentage"
                  ? fmtRate("percentage", result.baseAmount ? Math.round((result.totalAmount / result.baseAmount) * 100 * 10000) / 10000 : 0)
                  : fmtInr(result.areaSqYards ? Math.round((result.totalAmount / result.areaSqYards) * 100) / 100 : 0)}
              </div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">People paid</div>
              <div className="text-2xl font-extrabold tabular-nums">{result.lines.length}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Position</th><th>Person</th><th>Level</th><th>Decision</th>
                  <th className="text-right">Level {rb === "percentage" ? "%" : "rate"}</th><th className="text-right">Already paid below</th>
                  <th className="text-right">Payable {rb === "percentage" ? "%" : "/ sq yd"}</th><th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.decisions.map((d) => {
                  const l = lineFor(d.employeeId, d.chainDepth);
                  return (
                    <tr key={`${d.employeeId}-${d.chainDepth}`}>
                      <td className="whitespace-nowrap text-xs">{d.chainDepth === 0 ? "Seller" : `Upline ${d.chainDepth}`}</td>
                      <td><div className="font-medium">{l?.fullName ?? d.employeeCode}</div><div className="text-xs text-muted">{d.employeeCode}</div></td>
                      <td>{d.employeeLevel ? <span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-xs font-bold text-gold-strong">L{d.employeeLevel}</span> : <span className="text-xs text-muted">—</span>}</td>
                      <td>{d.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="neutral">{d.reason}</Badge>}</td>
                      <td className="text-right tabular-nums">{l ? fmtRate(rb, l.levelRate) : "—"}</td>
                      <td className="text-right tabular-nums text-muted">{l ? fmtRate(rb, l.baselineRate) : "—"}</td>
                      <td className="text-right tabular-nums">{l ? fmtRate(rb, l.payableRate) : "—"}</td>
                      <td className="text-right font-semibold tabular-nums">{l ? fmtInr(l.amount) : "—"}</td>
                    </tr>
                  );
                })}
                {result.lines.filter((l) => l.beneficiaryRole === "ceo_entitlement").map((l) => (
                  <tr key={`ceo-${l.employeeId}`} className="bg-gold-soft/30">
                    <td className="text-xs">{ROLE[l.beneficiaryRole]}</td>
                    <td><div className="font-medium">{l.fullName}</div><div className="text-xs text-muted">{l.employeeCode}</div></td>
                    <td><span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-xs font-bold text-gold-strong">L1</span></td>
                    <td><Badge tone="gold">Separate entitlement</Badge></td>
                    <td className="text-right tabular-nums">{fmtRate(rb, l.levelRate)}</td>
                    <td className="text-right tabular-nums text-muted">—</td>
                    <td className="text-right tabular-nums">{fmtRate(rb, l.payableRate)}</td>
                    <td className="text-right font-semibold tabular-nums">{fmtInr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="border-t border-border px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">Total</td>
                  <td className="border-t border-border px-3 py-3 text-right font-extrabold tabular-nums">{fmtInr(result.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
