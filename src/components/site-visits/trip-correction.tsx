"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";
import { ACTION_LABELS, allowedActions, type TrackingAction } from "@/lib/geo";

/**
 * Manager correction of a team member's trip stage (e.g. the employee's phone died).
 * Requires a reason; recorded as a manual event without coordinates and audited.
 * Starting a trip is never possible on someone else's behalf (consent is personal).
 */
export function TripCorrection({ visitId, stage, visitStatus }: { visitId: string; stage: string; visitStatus: string }) {
  const router = useRouter();
  const options = allowedActions(stage).filter((a) => a !== "start");
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<TrackingAction | "">("");
  const [reason, setReason] = useState("");
  const [time, setTime] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (options.length === 0) return null;
  const needsOutcome = action === "complete" && visitStatus === "scheduled";

  async function submit() {
    if (!action) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/site-visits/${visitId}/tracking`, {
        method: "POST",
        body: { action, reason: reason.trim(), recordedAt: time ? new Date(time).toISOString() : undefined, outcome: needsOutcome ? outcome.trim() : undefined },
      });
      setOpen(false);
      setAction("");
      setReason("");
      setTime("");
      setOutcome("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-primary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <PencilLine size={14} aria-hidden />Correct the trip stage
      </button>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="corr-action" className="label">Record stage</label>
            <select id="corr-action" className="input py-1.5 text-sm" value={action} onChange={(e) => setAction(e.target.value as TrackingAction)}>
              <option value="">Choose…</option>
              {options.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="corr-time" className="label">Actual time (optional, last 24 h)</label>
            <input id="corr-time" type="datetime-local" className="input py-1.5 text-sm" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="corr-reason" className="label">Reason (required)</label>
            <input id="corr-reason" className="input py-1.5 text-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee's phone battery died at the site" />
          </div>
          {needsOutcome && (
            <div className="sm:col-span-2">
              <label htmlFor="corr-outcome" className="label">Outcome notes (required)</label>
              <textarea id="corr-outcome" className="input text-sm" rows={2} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" disabled={busy || !action || reason.trim().length < 3 || (needsOutcome && outcome.trim().length < 3)} onClick={() => void submit()}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}Save correction
            </Button>
            <span className="text-xs text-muted">Recorded as a manual correction under your name, without location.</span>
          </div>
          {err && <p role="alert" className="sm:col-span-2 text-sm text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}
