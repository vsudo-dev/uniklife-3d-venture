"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CalendarRange, Check, Download, FileCheck2, Landmark, Send, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, EmptyState, Notice, StatusBadge, cx } from "@/components/ui";

export interface Reconciliation {
  id: string;
  status: string;
  source: string;
  reportedAmount: number;
  externalReference: string | null;
  receivedAt: string;
}

export interface SettlementView {
  id: string;
  reference: string;
  periodType: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  entryCount: number;
  createdBy: string | null;
  submittedBy: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  paidConfirmedByName: string | null;
  paymentSource: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  reconciliations: Reconciliation[];
}

const PIPELINE = ["draft", "submitted", "approved", "finance_requested", "paid"] as const;
const STEP_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", finance_requested: "Finance requested", paid: "Paid" };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function Pipeline({ status }: { status: string }) {
  if (status === "cancelled") return <Badge tone="neutral">Cancelled</Badge>;
  const idx = PIPELINE.indexOf(status as (typeof PIPELINE)[number]);
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={`Status: ${STEP_LABEL[status] ?? status}`}>
      {PIPELINE.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cx(
              "rounded-full px-2 py-0.5 text-[0.7rem] font-bold",
              i < idx && "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success",
              i === idx && (s === "paid" ? "bg-success text-white" : "bg-gradient-to-br from-[#e9cf73] via-gold to-gold-strong text-[#1b1400]"),
              i > idx && "bg-surface-2 text-muted",
            )}
            aria-current={i === idx ? "step" : undefined}
          >
            {STEP_LABEL[s]}
          </span>
          {i < PIPELINE.length - 1 && <span className={cx("h-px w-3", i < idx ? "bg-success" : "bg-border")} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function SettlementsWorkspace({
  settlements, ready, canSettle, canApprove, currentUserId,
}: {
  settlements: SettlementView[];
  ready: { count: number; total: number };
  canSettle: boolean;
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const today = new Date();
  const [periodType, setPeriodType] = useState<"weekly" | "monthly">("weekly");
  const [periodStart, setPeriodStart] = useState(ymd(mondayOf(today)));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [recon, setRecon] = useState<Record<string, { ref: string; amount: string }>>({});
  const [payRef, setPayRef] = useState<Record<string, string>>({});

  const startDate = new Date(periodStart + "T00:00:00");
  const startError = Number.isNaN(startDate.getTime())
    ? "Choose a start date"
    : periodType === "weekly" && startDate.getDay() !== 1
      ? "Weekly settlements start on a Monday"
      : periodType === "monthly" && startDate.getDate() !== 1
        ? "Monthly settlements start on the 1st"
        : null;
  const endPreview = startError
    ? null
    : periodType === "weekly"
      ? ymd(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6))
      : ymd(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0));

  const presets =
    periodType === "weekly"
      ? [
          { label: "This week", value: ymd(mondayOf(today)) },
          { label: "Last week", value: ymd(new Date(mondayOf(today).getTime() - 7 * 86400000)) },
        ]
      : [
          { label: "This month", value: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) },
          { label: "Last month", value: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)) },
        ];

  async function run<T>(label: string, fn: () => Promise<T>, ok: string | ((r: T) => { tone: "success" | "danger"; text: string })) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(typeof ok === "string" ? { tone: "success", text: ok } : ok(r));
      router.refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const act = (id: string, action: "submit" | "approve" | "request_finance" | "cancel", ok: string, note?: string) =>
    run(`${action}:${id}`, () => api(`/api/commissions/settlements/${id}/action`, { body: { action, note } }), ok);

  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {canSettle && (
        <Card className="overflow-hidden">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><CalendarRange size={18} className="text-gold" aria-hidden /> Build a settlement</span>}
            subtitle={`Groups approved, unsettled entries of bookings confirmed in the period (India time). Ready now: ${ready.count} entries · ${inr(ready.total)}.`}
          />
          <div className="grid gap-4 p-5 md:grid-cols-[200px_220px_1fr] md:items-end">
            <div>
              <span className="label">Period</span>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1" role="radiogroup" aria-label="Period type">
                {(["weekly", "monthly"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={periodType === t}
                    onClick={() => {
                      setPeriodType(t);
                      setPeriodStart(t === "weekly" ? ymd(mondayOf(today)) : ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
                    }}
                    className={cx("rounded-lg px-2 py-1.5 text-xs font-semibold capitalize transition", periodType === t ? "bg-surface text-text shadow-sm ring-1 ring-gold/40" : "text-muted")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="period-start">{periodType === "weekly" ? "Week starting (Monday)" : "Month starting (1st)"}</label>
              <input id="period-start" type="date" className={cx("input", startError && "border-danger")} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => setPeriodStart(p.value)} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:border-gold">{p.label}</button>
              ))}
              <Button
                variant="gold"
                disabled={!!busy || !!startError}
                onClick={() =>
                  run(
                    "create",
                    () => api<{ reference: string; entryCount: number; total: number }>("/api/commissions/settlements", { body: { periodType, periodStart } }),
                    (r) => ({ tone: "success", text: `${r.reference} created with ${r.entryCount} entries (${inr(r.total)}). Submit it for approval next.` }),
                  )
                }
              >
                {busy === "create" ? "Building…" : "Create settlement"}
              </Button>
            </div>
            <p className={cx("text-xs md:col-span-3", startError ? "text-danger" : "text-muted")}>
              {startError ?? `Covers ${fmtDate(periodStart)} → ${fmtDate(endPreview!)}.`}
            </p>
          </div>
        </Card>
      )}

      {settlements.length === 0 ? (
        <Card><EmptyState title="No settlements yet">Approve ledger entries, then build a weekly or monthly settlement.</EmptyState></Card>
      ) : (
        settlements.map((s) => {
          const mine = s.createdBy === currentUserId || s.submittedBy === currentUserId;
          const payable = s.status === "approved" || s.status === "finance_requested";
          const r = recon[s.id] ?? { ref: "", amount: "" };
          return (
            <Card key={s.id} className={cx("overflow-hidden", s.status === "paid" && "shadow-[var(--glow)]")}>
              <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-extrabold tracking-tight">{s.reference}</h3>
                    <Badge tone="info">{s.periodType}</Badge>
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {fmtDate(s.periodStart)} → {fmtDate(s.periodEnd)} · {s.entryCount} entries{s.createdByName ? ` · created by ${s.createdByName}` : ""}
                    {s.approvedByName ? ` · approved by ${s.approvedByName}` : ""}
                  </div>
                  <div className="mt-2"><Pipeline status={s.status} /></div>
                </div>
                <div className="text-left lg:text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Total</div>
                  <div className="text-2xl font-extrabold tabular-nums"><span className={s.status === "paid" ? "text-success" : undefined}>{inr(s.totalAmount)}</span></div>
                  <a href={`/api/commissions/settlements/${s.id}/workbook`} download className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                    <Download size={14} aria-hidden /> XLSX workbook
                  </a>
                </div>
              </div>

              {s.status === "paid" && (
                <div className="px-5 pt-4">
                  <Notice tone="success" title="Paid">
                    Confirmed {s.paymentSource === "finance_reconciliation" ? "by accepting a matched finance reconciliation" : "by an authorized person"}
                    {s.paidConfirmedByName ? ` (${s.paidConfirmedByName})` : ""}{s.paidAt ? ` on ${fmtDateTime(s.paidAt)}` : ""} · reference <strong>{s.paymentReference}</strong>
                  </Notice>
                </div>
              )}
              {s.status === "cancelled" && s.cancelledReason && <p className="px-5 pt-4 text-sm text-muted">Cancelled: {s.cancelledReason}</p>}

              {(s.status !== "paid" && s.status !== "cancelled") && (
                <div className="flex flex-wrap gap-2 px-5 py-4">
                  {s.status === "draft" && canSettle && (
                    <Button variant="primary" disabled={!!busy} onClick={() => act(s.id, "submit", `${s.reference} submitted`)}><Send size={16} aria-hidden /> Submit for approval</Button>
                  )}
                  {s.status === "submitted" && canApprove && (
                    mine ? (
                      <span className="self-center text-xs text-warning">You created/submitted this settlement — another approver must approve it.</span>
                    ) : (
                      <Button variant="gold" disabled={!!busy} onClick={() => act(s.id, "approve", `${s.reference} approved`)}><Check size={16} aria-hidden /> Approve</Button>
                    )
                  )}
                  {s.status === "approved" && canSettle && (
                    <Button variant="primary" disabled={!!busy} onClick={() => act(s.id, "request_finance", `Finance payment requested for ${s.reference}`)}><Landmark size={16} aria-hidden /> Request finance payment</Button>
                  )}
                  {["draft", "submitted", "approved"].includes(s.status) && canSettle && (
                    <Button
                      variant="ghost"
                      className="text-danger"
                      disabled={!!busy}
                      onClick={() => {
                        const reason = window.prompt("Reason for cancelling this settlement (entries return to Approved)");
                        if (reason && reason.trim().length >= 3) act(s.id, "cancel", `${s.reference} cancelled`, reason.trim());
                      }}
                    >
                      <X size={16} aria-hidden /> Cancel
                    </Button>
                  )}
                </div>
              )}

              {payable && canSettle && canApprove && (
                <div className="grid gap-4 border-t border-border bg-surface-2/60 p-5 lg:grid-cols-2">
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold"><FileCheck2 size={16} className="text-gold" aria-hidden /> Record finance reconciliation</h4>
                    <p className="mt-0.5 text-xs text-muted">Enter the amount finance reports as paid. It is matched against the settlement total; only a matched record can be accepted.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                      <input aria-label="Finance reference" className="input" placeholder="Bank / UTR / batch reference" value={r.ref} onChange={(e) => setRecon({ ...recon, [s.id]: { ...r, ref: e.target.value } })} />
                      <input aria-label="Reported amount" className="input tabular-nums" inputMode="decimal" placeholder="Amount" value={r.amount} onChange={(e) => setRecon({ ...recon, [s.id]: { ...r, amount: e.target.value } })} />
                      <Button
                        variant="outline"
                        disabled={!!busy || r.ref.trim().length < 3 || !(Number(r.amount) >= 0) || r.amount.trim() === ""}
                        onClick={() =>
                          run(
                            `recon:${s.id}`,
                            async () => {
                              const res = await api<{ matched: boolean }>(`/api/commissions/settlements/${s.id}/reconciliations`, { body: { externalReference: r.ref.trim(), reportedAmount: Number(r.amount) } });
                              setRecon({ ...recon, [s.id]: { ref: "", amount: "" } });
                              return res;
                            },
                            (res) =>
                              res.matched
                                ? { tone: "success", text: "Reconciliation recorded as MATCHED — review and accept it below to mark the settlement paid." }
                                : { tone: "danger", text: "Recorded as a MISMATCH — the amount does not equal the settlement total, so it cannot be accepted." },
                          )
                        }
                      >
                        Record
                      </Button>
                    </div>
                  </div>
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold"><Banknote size={16} className="text-gold" aria-hidden /> Confirm payment directly</h4>
                    <p className="mt-0.5 text-xs text-muted">Only after you have verified the transfer. This marks every entry in the settlement as paid and notifies the employees.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input aria-label="Payment reference" className="input" placeholder="Payment reference" value={payRef[s.id] ?? ""} onChange={(e) => setPayRef({ ...payRef, [s.id]: e.target.value })} />
                      <Button
                        variant="gold"
                        disabled={!!busy || (payRef[s.id] ?? "").trim().length < 3}
                        onClick={() => {
                          if (!window.confirm(`Confirm that ${inr(s.totalAmount)} for ${s.reference} has been paid?`)) return;
                          run(`pay:${s.id}`, () => api(`/api/commissions/settlements/${s.id}/confirm-payment`, { body: { paymentReference: (payRef[s.id] ?? "").trim() } }), `${s.reference} marked paid`);
                        }}
                      >
                        Confirm paid
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {s.reconciliations.length > 0 && (
                <div className="border-t border-border">
                  <div className="px-5 pt-4 text-sm font-bold">Reconciliation records</div>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>Received</th><th>Source</th><th>Reference</th><th className="text-right">Reported</th><th>Match</th><th>Review</th></tr></thead>
                      <tbody>
                        {s.reconciliations.map((rc) => {
                          const open = ["matched", "mismatch", "received"].includes(rc.status);
                          return (
                            <tr key={rc.id}>
                              <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(rc.receivedAt)}</td>
                              <td className="text-xs">{rc.source === "uniklife_webhook" ? "UNIKLIFE.AI webhook" : "Manual entry"}</td>
                              <td className="text-xs">{rc.externalReference ?? "—"}</td>
                              <td className="text-right tabular-nums">
                                {inr(rc.reportedAmount)}
                                {rc.reportedAmount !== s.totalAmount && <div className="text-[0.7rem] text-danger">Δ {inr(Math.round((rc.reportedAmount - s.totalAmount) * 100) / 100)}</div>}
                              </td>
                              <td><StatusBadge status={rc.status} /></td>
                              <td>
                                {open && canSettle && canApprove ? (
                                  <div className="flex flex-wrap gap-1">
                                    <Button
                                      variant="gold"
                                      className="px-3 py-1 text-xs"
                                      disabled={!!busy || rc.status !== "matched" || !payable}
                                      title={rc.status !== "matched" ? "Only a matched amount can be accepted" : undefined}
                                      onClick={() => {
                                        if (!window.confirm("Accepting marks this settlement as PAID. Continue?")) return;
                                        run(`accept:${rc.id}`, () => api(`/api/commissions/reconciliations/${rc.id}/review`, { body: { decision: "accept" } }), "Reconciliation accepted — settlement marked paid");
                                      }}
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      className="px-3 py-1 text-xs text-danger"
                                      disabled={!!busy}
                                      onClick={() => {
                                        const note = window.prompt("Reason for rejecting this reconciliation") ?? "";
                                        if (note.trim()) run(`reject:${rc.id}`, () => api(`/api/commissions/reconciliations/${rc.id}/review`, { body: { decision: "reject", note: note.trim() } }), "Reconciliation rejected");
                                      }}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted">{open ? "Awaiting review" : "Reviewed"}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
