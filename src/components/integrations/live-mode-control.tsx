"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Field } from "@/components/ui";

interface Props {
  mode: "mock" | "live";
  canVerify: boolean;
  phrase: string;
  connectionId: string;
  available: boolean;
}

/** Org-admin only: mark the connection verified for LIVE delivery, or revert to MOCK. */
export function LiveModeControl({ mode, canVerify, phrase, connectionId, available }: Props) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!available) return <p className="text-sm text-muted">Webhook-only connections do not send outbound API events.</p>;
  if (!canVerify) {
    return <p className="text-sm text-muted">Only an organization administrator can switch this connection to live.</p>;
  }

  async function submit(enable: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/integrations/uniklife/verify-live", { body: { enable, connection_id: connectionId, confirmation: enable ? confirmation : undefined } });
      setMsg({ ok: true, text: enable ? "Marked as verified for live. Delivery still requires UNIKLIFE_LIVE_ENABLED=true on the server." : "Switched back to MOCK." });
      setConfirmation("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {mode === "mock" ? (
        <>
          <Field label={`Type "${phrase}" to confirm the real endpoint, payload format and auth were verified with UNIKLIFE.AI`} htmlFor="live-confirm">
            <input id="live-confirm" className="input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="danger" disabled={busy || confirmation.trim() !== phrase} onClick={() => submit(true)}>
            {busy ? "Saving…" : "Mark verified & switch to live"}
          </Button>
        </>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => submit(false)}>
          {busy ? "Saving…" : "Switch back to MOCK"}
        </Button>
      )}
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
