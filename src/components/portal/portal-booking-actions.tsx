"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, X } from "lucide-react";
import { api, newIdempotencyKey } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";
import { inr } from "@/lib/format";

/** Customer actions. Eligibility is decided by the server; these flags only hide unusable buttons. */
export function PortalBookingActions({ bookingId, canPay, canCancel, advanceDue }: { bookingId: string; canPay: boolean; canCancel: boolean; advanceDue: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");

  if (!canPay && !canCancel) return null;

  async function pay() {
    setBusy("pay");
    setErr(null);
    try {
      const s = await api<{ checkoutUrl: string }>(`/api/bookings/${bookingId}/pay`, { body: { idempotencyKey: newIdempotencyKey("pay") } });
      router.push(s.checkoutUrl);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    setErr(null);
    try {
      await api(`/api/bookings/${bookingId}/cancel`, { body: { reason: reason.trim() } });
      setConfirmCancel(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-bold">Next steps</h3>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {canPay && (
        <>
          <Button variant="gold" className="w-full" disabled={!!busy} onClick={pay} data-testid="portal-pay">
            {busy === "pay" ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}Pay advance {inr(advanceDue)}
          </Button>
          <p className="text-[0.7rem] text-muted">Payments currently use a simulated checkout for testing — no money is taken. Your booking is confirmed only after the server verifies the payment.</p>
        </>
      )}
      {canCancel && !confirmCancel && (
        <Button variant="ghost" className="w-full text-danger" disabled={!!busy} onClick={() => setConfirmCancel(true)}><X size={16} />Cancel booking request</Button>
      )}
      {canCancel && confirmCancel && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="label" htmlFor="cancel-reason">Reason for cancelling</label>
          <textarea id="cancel-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 5 characters" />
          <div className="flex gap-2">
            <Button variant="danger" disabled={!!busy || reason.trim().length < 5} onClick={cancel}>{busy === "cancel" && <Loader2 size={16} className="animate-spin" />}Confirm cancellation</Button>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep booking</Button>
          </div>
          <p className="text-[0.7rem] text-muted">The reserved plots are released immediately.</p>
        </div>
      )}
    </Card>
  );
}
