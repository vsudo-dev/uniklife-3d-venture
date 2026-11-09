"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { Card, CardHeader, cx } from "@/components/ui";
import { MessageLine, useAction } from "./use-action";

export interface Prefs {
  in_app: boolean;
  dashboard_alerts: boolean;
  whatsapp_via_uniklife: boolean;
  email_via_uniklife: boolean;
  push: boolean;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function Toggle({ id, checked, onChange, disabled, label, hint, badge }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string; badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-semibold">{label}{badge}</label>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50",
          checked ? "border-gold bg-gold" : "border-border bg-surface-2",
        )}
      >
        <span className={cx("absolute top-0.5 rounded-full bg-white shadow transition-all", checked ? "left-[1.4rem]" : "left-0.5")} style={{ height: 18, width: 18 }} />
      </button>
    </div>
  );
}

export function NotificationPreferences({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const { busy, msg, run, setMsg } = useAction();

  async function save(next: Prefs, okText = "Preferences saved") {
    const r = await run("save", () => api<{ preferences: Prefs }>("/api/notifications/preferences", { method: "PUT", body: next }), okText);
    if (r) setPrefs(r.preferences);
  }

  const set = (k: keyof Prefs) => (v: boolean) => void save({ ...prefs, [k]: v });

  /** Requests browser permission only when the user turns push on. */
  async function togglePush(on: boolean) {
    setPushNote(null);
    setMsg(null);
    if (!on) {
      try {
        const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
        const sub = await reg?.pushManager.getSubscription();
        await sub?.unsubscribe();
      } catch {
        /* ignore — preference is still turned off */
      }
      await save({ ...prefs, push: false }, "Push notifications turned off on this device");
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushNote("This browser does not support push notifications. On iPhone/iPad, install the app to your Home Screen first.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushNote(permission === "denied" ? "Notifications are blocked for this site. Allow them in your browser settings to enable push." : "Permission was not granted.");
      return;
    }
    let publicKey: string | undefined;
    try {
      const res = await fetch("/api/push/public-key", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { publicKey?: string; key?: string; vapidPublicKey?: string };
      publicKey = data.publicKey ?? data.vapidPublicKey ?? data.key;
    } catch {
      publicKey = undefined;
    }
    if (!publicKey) {
      setPushNote("Push notifications are not available on this server yet. In-app notifications continue to work.");
      return;
    }
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Service worker not ready")), 8000)),
      ]);
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setPushNote(res.status === 404 ? "Push subscriptions are not available on this server yet." : "The server could not register this device for push notifications.");
        return;
      }
      await save({ ...prefs, push: true }, "Push notifications enabled on this device");
    } catch (e) {
      setPushNote(`Could not enable push notifications: ${(e as Error).message}`);
    }
  }

  return (
    <Card>
      <CardHeader title="Notification preferences" subtitle="Choose how you hear about team bookings, reservations and follow-ups." />
      <div className="divide-y divide-border px-5">
        <Toggle id="pref-in-app" label="In-app notifications" hint="Shown in this notification center." checked={prefs.in_app} onChange={set("in_app")} disabled={!!busy} />
        <Toggle id="pref-dashboard" label="Dashboard alerts" hint="Highlights on your home dashboard." checked={prefs.dashboard_alerts} onChange={set("dashboard_alerts")} disabled={!!busy} />
        <Toggle
          id="pref-whatsapp"
          label="WhatsApp alerts (direct Meta)"
          
          hint="Requires a connected WhatsApp number, an approved alert template, your phone number and the running worker."
          checked={prefs.whatsapp_via_uniklife}
          onChange={set("whatsapp_via_uniklife")}
          disabled={!!busy}
        />
        <Toggle
          id="pref-email"
          label="Email alerts (SMTP)"
          
          hint="Requires verified SMTP settings and the running worker."
          checked={prefs.email_via_uniklife}
          onChange={set("email_via_uniklife")}
          disabled={!!busy}
        />
        <Toggle
          id="pref-push"
          label="Push notifications (this device)"
          hint="Your browser will ask for permission when you switch this on."
          checked={prefs.push}
          onChange={(v) => void togglePush(v)}
          disabled={!!busy}
        />
      </div>
      <div className="space-y-2 px-5 pb-5">
        {pushNote && <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">{pushNote}</p>}
        <MessageLine msg={msg} />
        {busy && <p className="text-xs text-muted" aria-live="polite">Saving…</p>}
      </div>
    </Card>
  );
}
