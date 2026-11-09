"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Notice } from "@/components/ui";
import { GoogleRouteMap } from "@/components/site-visits/google-route-map";
import type { MapMode, MapSettingsView } from "@/lib/services/maps";

const OPTIONS: { id: MapMode; title: string; body: string }[] = [
  { id: "google_maps", title: "Google Maps", body: "Real map with the fence circle, the recorded route and Start / Site / End markers on every trip. Needs a Google Maps key and billing." },
  { id: "gis_fence", title: "Stationary GIS fence", body: "Built-in fixed fence (venture centre + radius) with a simple route sketch. No Google account, key or billing needed." },
];

export function MapsSettings({ settings }: { settings: MapSettingsView }) {
  const router = useRouter();
  const [mode, setMode] = useState<MapMode>(settings.mode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ventureId, setVentureId] = useState(settings.ventures.find((v) => v.lat != null)?.id ?? "");
  const [showTest, setShowTest] = useState(false);
  const v = settings.ventures.find((x) => x.id === ventureId);
  const centre = v && v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api("/api/integrations/maps", { method: "POST", body: { mode } });
      setMsg({ ok: true, text: mode === "google_maps" ? "Saved. Site-visit trips now show on Google Maps." : "Saved. Site-visit trips use the built-in stationary GIS fence." });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Site-visit map" subtitle="Choose how a customer site visit is shown. Arrival and departure detection works the same in both." />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Site-visit map mode">
            {OPTIONS.map((o) => (
              <label key={o.id} className={`cursor-pointer rounded-xl border-2 p-4 ${mode === o.id ? "border-gold bg-gold-soft" : "border-border"}`}>
                <input type="radio" name="map-mode" className="sr-only" checked={mode === o.id} onChange={() => setMode(o.id)} />
                <div className="flex items-center gap-2 font-bold">{mode === o.id ? "●" : "○"} {o.title}
                  {o.id === "google_maps" && <Badge tone={settings.keyConfigured ? "success" : "warning"}>{settings.keyConfigured ? "key found on server" : "key missing"}</Badge>}
                  {settings.mode === o.id && <Badge>active now</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">{o.body}</p>
              </label>
            ))}
          </div>
          {mode === "google_maps" && !settings.keyConfigured && (
            <Notice tone="warning" title="Google Maps key not set">Add <code>GOOGLE_MAPS_API_KEY</code> in the server (Vercel) environment variables and redeploy, then choose Google Maps. See the guide below.</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || mode === settings.mode} onClick={save}>{busy ? "Saving…" : "Save choice"}</Button>
            <Button variant="outline" disabled={!settings.keyConfigured} onClick={() => setShowTest((s) => !s)}>{showTest ? "Hide test map" : "Test map"}</Button>
          </div>
          {msg && <Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice>}
        </div>
      </Card>

      {showTest && settings.testKey && (
        <Card>
          <CardHeader title="Test map" subtitle="If a map with a circle appears, the key works. Nothing is saved by testing." />
          <div className="space-y-3 p-5">
            <label className="label" htmlFor="map-test-venture">Venture to preview</label>
            <select id="map-test-venture" className="input max-w-sm" value={ventureId} onChange={(e) => setVentureId(e.target.value)}>
              {settings.ventures.map((x) => <option key={x.id} value={x.id}>{x.name}{x.lat == null ? " (no coordinates)" : ""}</option>)}
            </select>
            {centre && v
              ? <GoogleRouteMap key={v.id} apiKey={settings.testKey} centre={centre} radiusM={v.radiusM} height={320} />
              : <Notice tone="info">This venture has no map coordinates yet. Add latitude/longitude and a geofence radius in Edit venture, or pick another venture.</Notice>}
          </div>
        </Card>
      )}
    </div>
  );
}
