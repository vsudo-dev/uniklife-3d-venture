"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, EmptyState, Notice } from "@/components/ui";

export interface ApprovalEntry {
  id: string;
  bookingId: string;
  bookingNumber: string;
  plots: string[];
  employeeId: string;
  employeeCode: string;
  fullName: string;
  role: string;
  level: number;
  payableRate: number;
  basis?: "per_sq_yard" | "percentage";
  payableRatePercent?: number | null;
  baseAmount?: number | null;
  area: number;
  amount: number;
  planVersion: number;
}

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Approval queue for calculated ledger entries. Own entries are listed but cannot be selected. */
export function EntryApprovals({ entries, myEmployeeId }: { entries: ApprovalEntry[]; myEmployeeId: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const selectable = useMemo(() => entries.filter((e) => e.employeeId !== myEmployeeId), [entries, myEmployeeId]);
  const selTotal = entries.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.amount, 0);
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ count: number }>("/api/commissions/entries/decide", { body: { ids: [...selected], action, reason: action === "reject" ? reason : undefined } });
      setMsg({ tone: "success", text: `${r.count} entr${r.count === 1 ? "y" : "ies"} ${action === "approve" ? "approved" : "rejected"}.` });
      setSelected(new Set());
      setReason("");
      setRejecting(false);
      router.refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (entries.length === 0) return <EmptyState title="Nothing awaiting approval">New entries appear here when a booking is confirmed against a verified payment.</EmptyState>;

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <span className="font-semibold">{selected.size}</span> selected · <span className="font-semibold tabular-nums">{inr(Math.round(selTotal * 100) / 100)}</span>
          <p className="text-xs text-muted">Approval re-checks that each booking is still confirmed. You cannot approve your own commission.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="gold" disabled={busy || selected.size === 0} onClick={() => decide("approve")}><Check size={16} aria-hidden /> Approve selected</Button>
          <Button variant="outline" className="text-danger" disabled={busy || selected.size === 0} onClick={() => setRejecting((v) => !v)}><X size={16} aria-hidden /> Reject…</Button>
        </div>
      </div>
      {rejecting && (
        <div className="grid gap-2 border-b border-border bg-surface-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="reject-reason">Rejection reason (required, shared in the audit log)</label>
            <textarea id="reject-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Booking attribution under review" />
          </div>
          <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => decide("reject")}>Reject {selected.size} entr{selected.size === 1 ? "y" : "ies"}</Button>
        </div>
      )}
      {msg && <div className="px-5 pt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.id)))}
                  className="h-4 w-4 accent-[var(--gold)]"
                />
              </th>
              <th>Booking</th><th>Employee</th><th>Role</th><th>Level</th>
              <th className="text-right">Rate</th><th className="text-right">Area</th><th className="text-right">Amount</th><th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const own = e.employeeId === myEmployeeId;
              return (
                <tr key={e.id} className={own ? "opacity-60" : selected.has(e.id) ? "bg-gold-soft/40" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${e.bookingNumber} ${e.employeeCode}`}
                      disabled={own}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 accent-[var(--gold)]"
                    />
                  </td>
                  <td>
                    <Link href={`/bookings/${e.bookingId}`} className="font-semibold text-primary hover:underline">{e.bookingNumber}</Link>
                    <div className="text-xs text-muted">Plots {e.plots.join(", ")}</div>
                  </td>
                  <td>
                    <div className="font-medium">{e.fullName}</div>
                    <div className="text-xs text-muted">{e.employeeCode}{own && <> · <Badge tone="warning">your own — another approver required</Badge></>}</div>
                  </td>
                  <td className="whitespace-nowrap text-xs">{e.role.replace("_", " ")}</td>
                  <td><span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-xs font-bold text-gold-strong">L{e.level}</span></td>
                  <td className="text-right tabular-nums">
                    {e.basis === "percentage" ? (
                      <>{e.payableRatePercent ?? 0}%<div className="text-[0.7rem] text-muted">of {inr(e.baseAmount ?? 0)}</div></>
                    ) : (
                      <>{inr(e.payableRate)}<div className="text-[0.7rem] text-muted">per sq yd</div></>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{e.area.toLocaleString("en-IN")}</td>
                  <td className="text-right font-semibold tabular-nums">{inr(e.amount)}</td>
                  <td className="text-xs text-muted">v{e.planVersion}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
