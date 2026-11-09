"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Loader2, Pause, Play, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";

type Action = "approve" | "reject" | "pause" | "reactivate" | "archive";

export function DiscountActions({
  discountId,
  status,
  canApprove,
  canManage,
  fourEyesBlocked,
}: {
  discountId: string;
  status: string;
  canApprove: boolean;
  canManage: boolean;
  /** The viewer created/submitted this discount, so they may not approve it. */
  fourEyesBlocked: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: Action) {
    if ((action === "reject" || action === "archive") && note.trim().length < 3) {
      setMsg({ ok: false, text: "Please add a short note explaining the decision." });
      return;
    }
    setBusy(action);
    setMsg(null);
    try {
      await api(`/api/discounts/${discountId}/decision`, { body: { action, note: note.trim() || null } });
      setMsg({ ok: true, text: `Discount ${action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "pause" ? "paused" : action === "reactivate" ? "reactivated" : "archived"}.` });
      setNote("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const pending = status === "pending_approval";
  const showApproval = pending && canApprove;
  const showManage = canManage && ["active", "paused", "pending_approval", "rejected", "draft"].includes(status);
  if (!showApproval && !showManage && !pending) return null;

  return (
    <Card className="space-y-4 p-5">
      <h3 className="flex items-center gap-2 font-bold"><ShieldCheck size={18} className="text-gold" />Actions</h3>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}

      {(showApproval || showManage) && (
        <div>
          <label className="label" htmlFor="decision-note">Note (required to reject or archive)</label>
          <textarea id="decision-note" className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded in the approval history" />
        </div>
      )}

      {pending && (
        <div className="space-y-2">
          {!canApprove ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Awaiting approval by a user with discount approval rights.</p>
          ) : fourEyesBlocked ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" disabled aria-disabled title="Four-eyes rule"><Check size={16} />Approve</Button>
                <Button variant="outline" disabled aria-disabled title="Four-eyes rule"><X size={16} />Reject</Button>
              </div>
              <p className="rounded-xl bg-gold-soft px-3 py-2 text-xs text-gold-strong">
                <strong>Four-eyes rule:</strong> you created or last submitted this discount, so a different approver must review it. You can still archive it.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" disabled={!!busy} onClick={() => run("approve")}>{busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Approve</Button>
              <Button variant="outline" className="text-danger" disabled={!!busy} onClick={() => run("reject")}>{busy === "reject" ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}Reject</Button>
            </div>
          )}
        </div>
      )}

      {showManage && (
        <div className="grid gap-2">
          {status === "active" && (
            <Button variant="outline" disabled={!!busy} onClick={() => run("pause")}>{busy === "pause" ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}Pause</Button>
          )}
          {status === "paused" && (
            <Button variant="outline" disabled={!!busy} onClick={() => run("reactivate")}>{busy === "reactivate" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}Reactivate</Button>
          )}
          <Button variant="ghost" className="text-danger" disabled={!!busy} onClick={() => run("archive")}>{busy === "archive" ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}Archive</Button>
          <p className="text-[0.7rem] text-muted">Pausing or archiving stops new use immediately. Bookings that already reserved this discount are re-validated at payment confirmation and flagged for review if it is no longer valid.</p>
        </div>
      )}
    </Card>
  );
}
