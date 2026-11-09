"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";
import { inr } from "@/lib/format";

export function MockCheckout(p: { transactionId: string; amount: number; bookingNumber: string; status: string; reference: string; returnTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function simulate(outcome: "success" | "failure") {
    setBusy(outcome);
    setError(null);
    try {
      await api(`/api/payments/mock/${p.transactionId}/simulate`, { body: { outcome } });
      // The return page re-reads booking status from the server; it does not trust this screen.
      router.push(p.returnTo);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 bg-[repeating-linear-gradient(45deg,#7c2d12,#7c2d12_12px,#9a3412_12px,#9a3412_24px)] px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-white" data-testid="simulated-banner">
          <FlaskConical size={18} />Simulated payment — no real money
        </div>
        <div className="p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Mock payment gateway</div>
          <div className="mt-1 text-3xl font-extrabold">{inr(p.amount)}</div>
          <div className="mt-1 text-sm text-muted">Advance for booking {p.bookingNumber}</div>
          <div className="mt-1 font-mono text-xs text-muted">{p.reference}</div>
          {p.status !== "pending" ? (
            <p className="mt-5 rounded-xl bg-surface-2 px-4 py-3 text-sm">This checkout is already <strong>{p.status}</strong>.</p>
          ) : (
            <div className="mt-6 grid gap-2">
              <Button variant="gold" onClick={() => simulate("success")} disabled={!!busy} data-testid="simulate-success">
                {busy === "success" && <Loader2 size={16} className="animate-spin" />}Simulate successful payment
              </Button>
              <Button variant="outline" onClick={() => simulate("failure")} disabled={!!busy} data-testid="simulate-failure">
                {busy === "failure" && <Loader2 size={16} className="animate-spin" />}Simulate failed payment
              </Button>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <p className="mt-5 text-xs leading-relaxed text-muted">
            This screen stands in for a payment provider during development. The simulated outcome is delivered as a signed provider webhook and verified on the server;
            the booking is confirmed only by that server-side verification, never by this page.
          </p>
          <button className="mt-3 text-xs font-semibold text-primary" onClick={() => router.push(p.returnTo)}>Return without paying</button>
        </div>
      </Card>
    </div>
  );
}
