"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Field, Notice } from "@/components/ui";
import { CopyField } from "@/components/integrations/copy-field";
import { dateTime } from "@/lib/format";

interface Account { id: string; waba_id: string; phone_number_id: string; display_phone_number: string | null; verified_name: string | null; quality_rating: string | null; status: string; webhook_subscribed: boolean; last_error: string | null; connected_at: string }
interface EventRow { id: string; direction: string; counterparty: string | null; message_type: string | null; status: string | null; created_at: string }
interface Setup { configured: boolean; missing: string[]; appId: string | null; configId: string | null; graphVersion: string; callbackUrl: string }

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

export function WhatsappConnect({ setup, accounts, events }: { setup: Setup; accounts: Account[]; events: EventRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [to, setTo] = useState("");
  const [sdk, setSdk] = useState(false);
  const session = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  useEffect(() => {
    if (!setup.configured || !setup.appId) return;
    const onMessage = (ev: MessageEvent) => {
      if (!/^https:\/\/(www|web)\.facebook\.com$/.test(ev.origin)) return;
      try {
        const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d.event === "FINISH") session.current = { waba_id: d.data?.waba_id, phone_number_id: d.data?.phone_number_id };
      } catch { /* not for us */ }
    };
    window.addEventListener("message", onMessage);
    window.fbAsyncInit = () => { window.FB?.init({ appId: setup.appId, autoLogAppEvents: true, xfbml: false, version: setup.graphVersion }); setSdk(true); };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk"; s.async = true; s.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(s);
    } else if (window.FB) setSdk(true);
    return () => window.removeEventListener("message", onMessage);
  }, [setup]);

  async function post<T>(action: string, extra: Record<string, unknown>, label: string) {
    setBusy(label); setMsg(null);
    try { return await api<T>("/api/whatsapp", { method: "POST", body: { action, ...extra } }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return null; }
    finally { setBusy(null); }
  }

  function startSignup() {
    session.current = {};
    window.FB?.login((r) => {
      const code = r.authResponse?.code;
      if (!code) return setMsg({ ok: false, text: "Signup was cancelled or did not return a code." });
      // The FINISH message can arrive just after the login callback.
      setTimeout(async () => {
        const { waba_id, phone_number_id } = session.current;
        if (!waba_id || !phone_number_id) return setMsg({ ok: false, text: "Meta did not report the WhatsApp account. Finish every step of the signup window and try again." });
        const res = await post<{ subscribed: boolean; warning: string | null }>("connect", { code, wabaId: waba_id, phoneNumberId: phone_number_id }, "connect");
        if (res) { setMsg({ ok: true, text: res.subscribed ? "WhatsApp number connected." : `Connected, but webhooks are not subscribed: ${res.warning ?? "unknown error"}` }); router.refresh(); }
      }, 800);
    }, { config_id: setup.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } });
  }

  return (
    <div className="space-y-5">
      <a href="#waba-knowledge-base" className="inline-block text-sm font-semibold text-gold underline">Need help? Show the 3 setup steps</a>
      {!setup.configured && (
        <Notice tone="warning" title="One-time Meta setup needed">
          Your administrator needs to finish the Meta app setup before you can connect. See the administrator settings above.
          <details className="mt-2"><summary className="cursor-pointer">Show missing settings</summary><code className="text-xs">{setup.missing.join(", ")}</code></details>
        </Notice>
      )}

      <Card id="whatsapp-connect">
        <CardHeader title="Connect your business number" subtitle="Direct to Meta's WhatsApp Cloud API through Embedded Signup — no middleman." />
        <div className="space-y-4 p-5">
          <Button variant="gold" disabled={!setup.configured || !sdk || !!busy} onClick={startSignup}>{busy === "connect" ? "Connecting…" : "Connect with Meta"}</Button>
          <Field label="Callback URL — paste in Meta App → WhatsApp → Configuration" htmlFor="wa-cb"><CopyField value={setup.callbackUrl} label="Callback URL" /></Field>
          <p className="text-xs text-muted">Verify token = your <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>. Subscribe to <code>messages</code>. Deliveries are accepted only with a valid <code>X-Hub-Signature-256</code>.</p>
        </div>
      </Card>

      {msg && <Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice>}

      {accounts.map((a) => (
        <Card key={a.id}>
          <CardHeader
            title={<span className="flex flex-wrap items-center gap-2">{a.display_phone_number ?? a.phone_number_id} {a.verified_name && <span className="text-sm font-normal text-muted">{a.verified_name}</span>}
              <Badge tone={a.status === "connected" ? "success" : "danger"}>{a.status}</Badge>
              {a.quality_rating && <Badge>{`quality ${a.quality_rating.toLowerCase()}`}</Badge>}
              <Badge tone={a.webhook_subscribed ? "success" : "warning"}>{a.webhook_subscribed ? "webhooks on" : "webhooks off"}</Badge></span>}
            subtitle={`WABA ${a.waba_id} · connected ${dateTime(a.connected_at)}`}
          />
          {a.last_error && <div className="px-5 pt-4"><Notice tone="danger" title="Last error">{a.last_error}</Notice></div>}
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-2">
              <Field label="Send test template (hello_world) to" htmlFor={`wa-to-${a.id}`} hint="With country code, digits only. Use an opted-in recipient. The template must be available on this account.">
                <input id={`wa-to-${a.id}`} className="input" inputMode="tel" placeholder="919876543210" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button variant="outline" disabled={!to || !!busy} onClick={async () => {
                const r = await post<{ messageId: string | null }>("test", { accountId: a.id, to }, `test-${a.id}`);
                if (r) setMsg({ ok: true, text: `Sent. Message id ${r.messageId ?? "—"}; the delivery status appears below.` });
                router.refresh();
              }}>{busy === `test-${a.id}` ? "Sending…" : "Send test"}</Button>
            </div>
            <div className="flex items-end justify-end">
              <Button variant="outline" disabled={!!busy} onClick={async () => { if (!confirm("Disconnect this WhatsApp number and delete its stored token?")) return; if (await post("disconnect", { accountId: a.id }, `dc-${a.id}`)) router.refresh(); }}>Disconnect</Button>
            </div>
          </div>
        </Card>
      ))}
      {!accounts.length && <p className="text-sm text-muted">No WhatsApp number connected yet.</p>}

      <Card className="overflow-hidden">
        <CardHeader title="Recent WhatsApp activity" subtitle="Numbers are masked; message bodies are never stored." />
        <div className="max-h-96 overflow-auto">
          <table className="table">
            <thead><tr><th>When</th><th>Type</th><th>Contact</th><th>Detail</th></tr></thead>
            <tbody>
              {events.map((e) => <tr key={e.id}><td className="text-xs">{dateTime(e.created_at)}</td><td>{e.direction}</td><td className="font-mono text-xs">{e.counterparty ?? "—"}</td><td className="text-xs">{e.status ?? e.message_type ?? "—"}</td></tr>)}
              {!events.length && <tr><td colSpan={4} className="py-6 text-center text-muted">No activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
