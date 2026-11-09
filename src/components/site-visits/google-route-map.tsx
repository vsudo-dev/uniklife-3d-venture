"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "@/lib/geo";

/* eslint-disable @typescript-eslint/no-explicit-any -- Google Maps loads at runtime; no bundled types. */
let loading: Promise<any> | null = null;

function loadGoogleMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    // Google calls this when the key is invalid, restricted for this site, or billing is off.
    w.gm_authFailure = () => reject(new Error("Google rejected the API key (check key restrictions, enabled Maps JavaScript API and billing)."));
    w.__gmReady = () => resolve(w.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__gmReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Could not load Google Maps (network or blocker)."));
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

export interface GoogleRouteMapProps {
  apiKey: string;
  centre: LatLng | null;
  radiusM: number;
  path?: LatLng[];
  start?: LatLng | null;
  end?: LatLng | null;
  last?: LatLng | null;
  height?: number;
  /** Shown when Google cannot load (wrong key, blocked, offline). */
  fallback?: ReactNode;
}

/** Google Map with the stationary site geofence (circle), the recorded route and start/end/last markers. */
export function GoogleRouteMap({ apiKey, centre, radiusM, path = [], start, end, last, height = 280, fallback }: GoogleRouteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !el.current) return;
      const map = new maps.Map(el.current, { center: centre ?? path[0] ?? start ?? { lat: 20.5937, lng: 78.9629 }, zoom: 15, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      const bounds = new maps.LatLngBounds();
      if (centre) {
        new maps.Circle({ map, center: centre, radius: radiusM, strokeColor: "#b8860b", strokeWeight: 2, fillColor: "#d4a017", fillOpacity: 0.15 });
        new maps.Marker({ map, position: centre, title: `Site (geofence ${radiusM} m)`, label: "Site" });
        const c = new maps.Circle({ center: centre, radius: radiusM });
        bounds.union(c.getBounds());
      }
      if (path.length > 1) new maps.Polyline({ map, path, strokeColor: "#1d4ed8", strokeWeight: 4, strokeOpacity: 0.9 });
      path.forEach((p) => bounds.extend(p));
      const mark = (p: LatLng | null | undefined, label: string, title: string) => { if (p) { new maps.Marker({ map, position: p, label, title }); bounds.extend(p); } };
      mark(start, "S", "Start"); mark(end, "E", "End"); mark(last && !end ? last : null, "•", "Last known");
      if (!bounds.isEmpty()) map.fitBounds(bounds, 32);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // Re-draw only when the data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, centre?.lat, centre?.lng, radiusM, path.length, start?.lat, end?.lat, last?.lat]);

  if (error) {
    return <div className="space-y-2">{fallback}<p role="alert" className="rounded-lg bg-surface-2 p-2 text-xs text-danger">Google Maps unavailable: {error} Showing the built-in map instead.</p></div>;
  }
  return <div ref={el} role="img" aria-label="Google Map of the site geofence and route" className="w-full overflow-hidden rounded-xl border border-border bg-surface-2" style={{ height }} />;
}
