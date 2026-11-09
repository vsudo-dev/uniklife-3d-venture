"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";

interface Summary {
  claimed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  results?: { status: string; error?: string | null; externalReference?: string | null }[];
}

/** "Send test event" and "Dispatch now" — both call internal endpoints of this app. */
export function IntegrationActions({ enabled, connectionId }: { enabled: boolean; connectionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(label: string, url: string) {
    setBusy(label);
    setMsg(null);
    try {
      const s = await api<Summary>(url, { method: "POST", body: { connection_id: connectionId } });
      const first = s.results?.[0];
      const detail = first?.externalReference ? ` · ref ${first.externalReference}` : first?.error ? ` · ${first.error}` : "";
      setMsg({ ok: s.failed + s.deadLettered === 0, text: `${s.claimed} dispatched: ${s.delivered} delivered, ${s.failed} failed, ${s.deadLettered} dead-lettered${detail}` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="gold" disabled={!enabled || !!busy} onClick={() => run("test", "/api/integrations/uniklife/test-event")}>
          {busy === "test" ? "Sending…" : "Send test event"}
        </Button>
        <Button variant="outline" disabled={!enabled || !!busy} onClick={() => run("sync", "/api/integrations/uniklife/sync")}>
          {busy === "sync" ? "Dispatching…" : "Dispatch now"}
        </Button>
      </div>
      {!enabled && <p className="text-xs text-muted">Enable and save the connection to send events.</p>}
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
