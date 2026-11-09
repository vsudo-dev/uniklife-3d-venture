"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, newIdempotencyKey } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";

interface Props {
  bookingId: string;
  status: string;
  outstandingAdvance: number;
  outstanding: number;
  can: { pay: boolean; cancel: boolean; complete: boolean; confirm: boolean; recordPayment: boolean; attribution: boolean };
  attributionLocked: boolean;
}

export function BookingActions({ bookingId, status, outstandingAdvance, outstanding, can, attributionLocked }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [offline, setOffline] = useState({ amount: "", reference: "", method: "bank_transfer" });
  const [attr, setAttr] = useState({ employeeCode: "", reason: "" });
  const offlineKey = useRef(newIdempotencyKey("offline"));

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const live = status === "payment_pending" || status === "confirmed";
  if (!live && !can.attribution) return null;

  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-bold">Actions</h3>
      {msg && <p role="status" className={msg.tone === "ok" ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}

      {can.pay && status === "payment_pending" && outstandingAdvance > 0 && (
        <Button
          variant="gold"
          className="w-full"
          disabled={!!busy}
          data-testid="pay-advance"
          onClick={() =>
            run("pay", async () => {
              const s = await api<{ checkoutUrl: string }>(`/api/bookings/${bookingId}/pay`, { body: { idempotencyKey: newIdempotencyKey("pay") } });
              router.push(s.checkoutUrl);
            }, "Opening checkout…")
          }
        >
          Collect advance (simulated checkout)
        </Button>
      )}

      {can.recordPayment && live && outstanding > 0 && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Record verified offline payment</summary>
          <div className="mt-3 grid gap-2">
            <input className="input" placeholder="Amount" inputMode="decimal" value={offline.amount} onChange={(e) => setOffline({ ...offline, amount: e.target.value })} aria-label="Amount" />
            <input className="input" placeholder="Bank / UTR / cheque reference" value={offline.reference} onChange={(e) => setOffline({ ...offline, reference: e.target.value })} aria-label="Reference" />
            <select className="input" value={offline.method} onChange={(e) => setOffline({ ...offline, method: e.target.value })} aria-label="Method">
              <option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque (cleared)</option><option value="cash">Cash</option><option value="other">Other</option>
            </select>
            <p className="text-xs text-muted">Record only payments you have verified against a bank statement or cleared instrument.</p>
            <Button variant="outline" disabled={!!busy || !offline.amount || offline.reference.length < 3}
              onClick={() => run("offline", () => api(`/api/bookings/${bookingId}/offline-payment`, { body: { amount: Number(offline.amount), reference: offline.reference, method: offline.method, purpose: status === "confirmed" ? "balance" : "booking_amount", idempotencyKey: offlineKey.current } }).then(() => { offlineKey.current = newIdempotencyKey("offline"); }), "Payment recorded")}>
              Save payment
            </Button>
          </div>
        </details>
      )}

      {can.confirm && status === "payment_pending" && (
        <Button variant="primary" className="w-full" disabled={!!busy} onClick={() => run("confirm", () => api("/api/bookings/confirm", { body: { bookingId } }), "Booking confirmed")}>
          Confirm booking (requires verified advance)
        </Button>
      )}

      {can.complete && status === "confirmed" && (
        <Button variant="primary" className="w-full" disabled={!!busy} onClick={() => run("complete", () => api(`/api/bookings/${bookingId}/complete`, { method: "POST", body: {} }), "Sale completed — plots marked sold")}>
          Complete sale (mark plots sold)
        </Button>
      )}

      {can.attribution && !attributionLocked && (status === "payment_pending" || status === "confirmed" || status === "completed") && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Correct sales attribution</summary>
          <div className="mt-3 grid gap-2">
            <input className="input uppercase" placeholder="Employee ID (e.g. EMP-00125)" value={attr.employeeCode} onChange={(e) => setAttr({ ...attr, employeeCode: e.target.value.toUpperCase() })} aria-label="Employee ID" />
            <textarea className="input" rows={2} placeholder="Reason (required, audited)" value={attr.reason} onChange={(e) => setAttr({ ...attr, reason: e.target.value })} aria-label="Reason" />
            <Button variant="outline" disabled={!!busy || attr.employeeCode.length < 3 || attr.reason.trim().length < 5} onClick={() => run("attr", () => api(`/api/bookings/${bookingId}/attribution`, { body: attr }), "Attribution updated")}>
              Save attribution
            </Button>
          </div>
        </details>
      )}

      {can.cancel && live && (
        <Button variant="ghost" className="w-full text-danger" disabled={!!busy}
          onClick={() => {
            const reason = window.prompt("Reason for cancellation (min 5 characters)");
            if (reason && reason.trim().length >= 5) run("cancel", () => api(`/api/bookings/${bookingId}/cancel`, { body: { reason } }), "Booking cancelled");
          }}>
          Cancel booking
        </Button>
      )}
    </Card>
  );
}
