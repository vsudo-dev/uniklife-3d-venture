"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Card, CardHeader, Notice } from "@/components/ui";

export function ApprovalVerification({ ventureId, authority, reference, verified, verifiedBy, verifiedAt }: {
  ventureId: string;
  authority: string | null;
  reference: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(nextVerified: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/ventures/${ventureId}/approval-verification`, { method: "POST", body: { verified: nextVerified, note } });
      setNote("");
      setMsg({ ok: true, text: nextVerified ? "Marked as verified." : "Verification removed." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Approval verification"
        subtitle="Record that a staff member checked the approval reference against the source documents."
        action={verified ? <ShieldCheck className="text-success" aria-label="Verified" /> : <ShieldAlert className="text-warning" aria-label="Unverified" />}
      />
      <div className="space-y-3 p-5 text-sm">
        {!reference ? (
          <Notice tone="neutral">No approval reference has been entered yet. Save one in the form first.</Notice>
        ) : verified ? (
          <Notice tone="success" title="Verified by staff">
            {authority ? `${authority} · ` : ""}{reference} — verified{verifiedBy ? ` by ${verifiedBy}` : ""}{verifiedAt ? ` on ${new Date(verifiedAt).toLocaleDateString("en-IN")}` : ""}.
          </Notice>
        ) : (
          <Notice tone="warning" title="Unverified">
            {authority ? `${authority} · ` : ""}{reference} — user-provided, treated as unverified until a staff member verifies it against source documents.
          </Notice>
        )}
        {reference && (
          <>
            <label className="label" htmlFor="approval-note">{verified ? "Reason for removing verification" : "How was it verified? (document, portal, date)"}</label>
            <textarea id="approval-note" className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={verified ? "e.g. Approval withdrawn / reference corrected" : "e.g. Checked LP order copy and authority portal on 12 Oct 2026"} />
            <div className="flex flex-wrap gap-2">
              {verified ? (
                <Button variant="outline" disabled={busy || note.trim().length < 3} onClick={() => submit(false)}>Mark unverified</Button>
              ) : (
                <Button variant="primary" disabled={busy || note.trim().length < 5} onClick={() => submit(true)}>Mark verified</Button>
              )}
            </div>
          </>
        )}
        {msg && <p role="status" className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</p>}
      </div>
    </Card>
  );
}
