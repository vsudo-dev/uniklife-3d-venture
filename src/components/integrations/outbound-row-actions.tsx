"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";

/** Retry (failed / dead_letter) or replay (delivered, same idempotency key) one outbound event. */
export function OutboundRowActions({ id, status, loopSuppressed }: { id: string; status: string; loopSuppressed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loopSuppressed || !["failed", "dead_letter", "delivered"].includes(status)) return null;
  const kind = status === "delivered" ? "replay" : "retry";

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api<{ delivered: number; results: { status: string; error?: string | null }[] }>(`/api/integrations/outbound/${id}/${kind}`, { method: "POST" });
      setMsg(s.delivered ? "Delivered" : s.results[0]?.error ?? s.results[0]?.status ?? "Queued");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={kind === "retry" ? "primary" : "outline"} className="px-3 py-1 text-xs" disabled={busy} onClick={run}
        title={kind === "replay" ? "Re-send with the same idempotency key" : "Reset to pending and dispatch now"}>
        {busy ? "…" : kind === "retry" ? "Retry" : "Replay"}
      </Button>
      {msg && <span role="status" className="max-w-[12rem] text-xs text-muted">{msg}</span>}
    </div>
  );
}
