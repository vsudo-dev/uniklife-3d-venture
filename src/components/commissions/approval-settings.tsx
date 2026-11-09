"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { Card, CardHeader, Notice } from "@/components/ui";

/** Organization setting: does a commission plan need a second approver (four-eyes)? Org admins may change it. */
export function ApprovalSettingsCard({ requiresSecondApprover, canEdit }: { requiresSecondApprover: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(requiresSecondApprover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (!next && !window.confirm("Allow the person who submits a commission plan to approve it themselves? Every approval stays recorded in the history and audit log.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ requiresSecondApprover: boolean }>("/api/commissions/settings", { method: "PUT", body: { requiresSecondApprover: next } });
      setValue(r.requiresSecondApprover);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-gold" aria-hidden /> Approval process</span>} />
      <div className="space-y-3 px-5 pb-5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--gold)]"
            checked={value}
            disabled={!canEdit || busy}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span>
            <strong>Require a second approver</strong>
            <span className="block text-xs text-muted">
              {value
                ? "Four-eyes: a plan must be approved by someone other than the person who submitted it."
                : "Single-approver mode: an administrator may approve a plan they submitted. Approvals are still recorded."}
            </span>
          </span>
        </label>
        {!canEdit && <p className="text-xs text-muted">Only organization administrators can change this setting.</p>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Card>
  );
}
