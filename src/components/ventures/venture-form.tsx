"use client";

import { useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Clock, ExternalLink, LocateFixed, MapPin, Ruler, ScrollText, Box, Rocket } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/viewer-settings";
import { Badge, Button, Card, Field, Notice } from "@/components/ui";
import { TagInput } from "./tag-input";

export interface VentureFormValues {
  name: string;
  code: string;
  slug: string;
  description: string;
  locationText: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
  surveyNumbers: string;
  approvalAuthority: string;
  approvalReference: string;
  totalLandArea: string;
  landAreaUnit: "acres" | "sq_yards" | "sq_meters" | "hectares";
  declaredTotalPlots: string;
  roadsDescription: string;
  amenities: string[];
  launchDate: string;
  status: "draft" | "upcoming" | "launched" | "sold_out" | "on_hold" | "archived";
  isPublished: boolean;
  holdMinutes: string;
  bookingAmountPercent: string;
  viewerMode: "procedural" | "glb";
  propertyType?: PropertyType;
  geofenceRadiusM?: string;
}

export const EMPTY_VENTURE: VentureFormValues = {
  name: "", code: "", slug: "", description: "", locationText: "", city: "", state: "", latitude: "", longitude: "", surveyNumbers: "",
  approvalAuthority: "", approvalReference: "", totalLandArea: "", landAreaUnit: "acres", declaredTotalPlots: "", roadsDescription: "",
  amenities: [], launchDate: "", status: "draft", isPublished: false, holdMinutes: "", bookingAmountPercent: "", viewerMode: "procedural",
  propertyType: "open_plot", geofenceRadiusM: "300",
};

const AMENITY_SUGGESTIONS = ["Clubhouse", "Children's park", "Gated entry", "24×7 security", "Underground drainage", "Street lighting", "Avenue plantation", "Water supply", "Jogging track", "Temple"];

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function codeFrom(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.slice(0, 6))
    .join("-")
    .slice(0, 32);
}

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

function Section({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border bg-gradient-to-r from-gold-soft/60 to-transparent px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-strong" aria-hidden>{icon}</span>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export function VentureForm({ mode, ventureId, initial, isDemo }: { mode: "create" | "edit"; ventureId?: string; initial?: VentureFormValues; isDemo?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<VentureFormValues>({ ...EMPTY_VENTURE, ...(initial ?? {}) });
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [codeTouched, setCodeTouched] = useState(mode === "edit");
  const [layoutFile,setLayoutFile]=useState<File|null>(null);
  const [inventoryFile,setInventoryFile]=useState<File|null>(null);
  const createdId=useRef<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [geo, setGeo] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: true });

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({ busy: false, ok: false, text: "This browser cannot share its location. Enter the coordinates manually." });
      return;
    }
    setGeo({ busy: true, ok: true, text: "Getting your location…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("latitude", pos.coords.latitude.toFixed(6));
        set("longitude", pos.coords.longitude.toFixed(6));
        setGeo({ busy: false, ok: true, text: `Location captured (accuracy about ${Math.round(pos.coords.accuracy)} m). Make sure you are at the venture site.` });
      },
      (err) => setGeo({ busy: false, ok: false, text: err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Could not get your location. Try again or enter it manually." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const set =<K extends keyof VentureFormValues>(k: K, val: VentureFormValues[K]) => {
    setSaved(false);
    setV((prev) => {
      const next = { ...prev, [k]: val };
      if (k === "name") {
        if (!slugTouched) next.slug = slugify(String(val));
        if (!codeTouched) next.code = codeFrom(String(val));
      }
      return next;
    });
  };
  const fe = (k: string) => fieldErrors[k] ?? null;
  const latN = v.latitude.trim() === "" ? NaN : Number(v.latitude);
  const lngN = v.longitude.trim() === "" ? NaN : Number(v.longitude);
  const latLngValid = Number.isFinite(latN) && Number.isFinite(lngN) && Math.abs(latN) <= 90 && Math.abs(lngN) <= 180;
  const approvalChanged =mode === "edit" && initial && (initial.approvalReference !== v.approvalReference || initial.approvalAuthority !== v.approvalAuthority);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: v.name, code: v.code, slug: v.slug, description: v.description || null, locationText: v.locationText || null, city: v.city || null,
      state: v.state || null, latitude: numOrNull(v.latitude), longitude: numOrNull(v.longitude), surveyNumbers: v.surveyNumbers || null,
      approvalAuthority: v.approvalAuthority || null, approvalReference: v.approvalReference || null, totalLandArea: numOrNull(v.totalLandArea),
      landAreaUnit: v.landAreaUnit, declaredTotalPlots: numOrNull(v.declaredTotalPlots), roadsDescription: v.roadsDescription || null,
      amenities: v.amenities, launchDate: v.launchDate || null, status: v.status, isPublished: v.isPublished, holdMinutes: numOrNull(v.holdMinutes),
      bookingAmountPercent: numOrNull(v.bookingAmountPercent), viewerMode: v.viewerMode,
      propertyType: v.propertyType ?? "open_plot", geofenceRadiusM: numOrNull(v.geofenceRadiusM ?? "") ?? 300,
    };
    try {
      if (mode === "create") {
        const res = createdId.current ? {id:createdId.current} : await api<{ id: string }>("/api/ventures", { method: "POST", body: payload });
        createdId.current=res.id;
        if(layoutFile){
          const body=new FormData();body.set("kind","layout_pdf");body.set("file",layoutFile);
          const uploaded=await fetch(`/api/ventures/${res.id}/assets`,{method:"POST",body});
          const result=await uploaded.json();if(!uploaded.ok)throw new Error(result.error?.message??"Venture created, but PDF upload failed. Retry or open its Assets page.");
          await api(`/api/ventures/${res.id}/assets/roles`,{method:"POST",body:{role:"layout_pdf",assetId:result.asset.id}});
        }
        if(inventoryFile)sessionStorage.setItem(`venture-csv:${res.id}`,await inventoryFile.text());
        router.push(layoutFile||inventoryFile?`/plots/import?venture=${res.id}`:`/ventures/${res.id}/assets`);
      } else {
        await api(`/api/ventures/${ventureId}`, { method: "PUT", body: payload });
        setSaved(true);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as { path: string; message: string }[]) map[d.path] = d.message;
        setFieldErrors(map);
        setError("Please correct the highlighted fields.");
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = (k: keyof VentureFormValues, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}, hint?: ReactNode) => (
    <Field label={label} htmlFor={`vf-${k}`} error={fe(k)} hint={hint}>
      <input id={`vf-${k}`} className="input" value={(v[k] as string | undefined) ?? ""} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
        {mode==="create" && <Card className="p-5"><h2 className="mb-3 font-bold">Upload layout and inventory here</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Layout PDF" htmlFor="new-layout-pdf"><input id="new-layout-pdf" type="file" accept="application/pdf,.pdf" className="input" onChange={e=>setLayoutFile(e.target.files?.[0]??null)}/></Field><Field label="Plot inventory CSV (optional)" htmlFor="new-inventory-csv"><input id="new-inventory-csv" type="file" accept="text/csv,.csv" className="input" onChange={e=>setInventoryFile(e.target.files?.[0]??null)}/></Field></div><p className="mt-3 text-sm text-muted">After the venture is created, the file is read into inventory preview. Review dimensions, facing and prices before confirming. Scanned or unfamiliar layouts may need OCR and survey review.</p></Card>}

      <Section icon={<Building2 size={18} />} title="Identity" subtitle="How the venture is named across the app, URLs and integrations.">
        {text("name", "Venture name", { required: true, maxLength: 160, placeholder: "e.g. Sunrise Meadows" })}
        <Field label="Venture code" htmlFor="vf-code" error={fe("code")} hint="2–32 characters: A–Z, 0–9 and hyphens. Unique in your organization.">
          <input id="vf-code" className="input uppercase" value={v.code} maxLength={32} required
            onChange={(e) => { setCodeTouched(true); set("code", e.target.value.toUpperCase()); }} />
        </Field>
        <Field label="URL slug" htmlFor="vf-slug" error={fe("slug")} hint={<>Suggested from the name. Lowercase letters, digits and hyphens.{!slugTouched ? " (auto)" : ""}</>}>
          <div className="flex gap-2">
            <input id="vf-slug" className="input" value={v.slug} maxLength={81} required onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }} />
            {slugTouched && <Button type="button" variant="outline" onClick={() => { setSlugTouched(false); set("slug", slugify(v.name)); }}>Suggest</Button>}
          </div>
        </Field>
        <Field label="Property type" htmlFor="vf-propertyType" error={fe("propertyType")} hint="Default for every plot in this venture; individual plots can override it. Commission plans can target a property type.">
          <select id="vf-propertyType" className="input" value={v.propertyType ?? "open_plot"} onChange={(e) => set("propertyType", e.target.value as PropertyType)}>
            {PROPERTY_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <div className="text-sm text-muted">
            Demo venture: {isDemo ? <Badge tone="gold">Yes — demonstration data</Badge> : <Badge>No</Badge>}
            <p className="mt-1 text-xs">Read-only. Demo ventures are created by the seed and are clearly labelled.</p>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="vf-description" error={fe("description")}>
            <textarea id="vf-description" className="input" rows={3} maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section icon={<MapPin size={18} />} title="Location & geofence" subtitle="Address plus the site coordinates used for maps and site-visit arrival detection.">
        <div className="sm:col-span-2">{text("locationText", "Location / address", { maxLength: 300, placeholder: "Village, mandal, landmark" })}</div>
        {text("city", "City", { maxLength: 80 })}
        {text("state", "State", { maxLength: 80 })}
        {text("latitude", "Latitude", { inputMode: "decimal", placeholder: "17.385044" }, "−90 to 90 · geofence centre")}
        {text("longitude", "Longitude", { inputMode: "decimal", placeholder: "78.486671" }, "−180 to 180 · geofence centre")}
        {text("geofenceRadiusM", "Geofence radius (metres)", { inputMode: "numeric", type: "number", min: 50, max: 5000, step: 10, placeholder: "300" }, "50–5000 m around the latitude/longitude above")}
        <div className="flex flex-wrap items-end gap-2">
          <Button type="button" variant="outline" onClick={captureLocation} disabled={geo.busy}>
            <LocateFixed size={16} aria-hidden /> {geo.busy ? "Locating…" : "Use my current location"}
          </Button>
          {latLngValid ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(v.latitude)},${Number(v.longitude)}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-primary hover:underline"
            >
              <ExternalLink size={14} aria-hidden /> Open in Google Maps
            </a>
          ) : (
            <span className="px-1 py-2 text-xs text-muted">Enter latitude and longitude to preview on Google Maps.</span>
          )}
        </div>
        {geo.text && <p role="status" className={`sm:col-span-2 text-sm ${geo.ok ? "text-muted" : "text-danger"}`}>{geo.text}</p>}
        <div className="sm:col-span-2">
          <Notice tone="info" title="How the geofence is used">
            The latitude/longitude form the geofence centre. During a consented site-visit trip, an employee is marked as arrived when their device is within
            {" "}{v.geofenceRadiusM || "300"} m of this point. Without coordinates, arrival is recorded manually only.
          </Notice>
        </div>
      </Section>

      <Section icon={<ScrollText size={18} />} title="Survey & approval" subtitle="Legal references as provided by the developer.">
        <div className="sm:col-span-2">{text("surveyNumbers", "Survey numbers", { maxLength: 500, placeholder: "Sy. No. 123/A, 124" })}</div>
        {text("approvalAuthority", "Approval authority", { maxLength: 200, placeholder: "e.g. HMDA / DTCP / RERA" })}
        {text("approvalReference", "Approval reference", { maxLength: 200, placeholder: "LP / permit / RERA number" })}
        <div className="sm:col-span-2">
          <Notice tone="warning" title="User-provided">
            User-provided — treated as unverified until a staff member verifies it against source documents.
            {approvalChanged && " Changing the authority or reference clears any existing verification."}
          </Notice>
        </div>
      </Section>

      <Section icon={<Ruler size={18} />} title="Land & layout">
        <Field label="Total land area" htmlFor="vf-totalLandArea" error={fe("totalLandArea")}>
          <div className="flex gap-2">
            <input id="vf-totalLandArea" className="input" inputMode="decimal" value={v.totalLandArea} onChange={(e) => set("totalLandArea", e.target.value)} />
            <select aria-label="Land area unit" className="input max-w-[9rem]" value={v.landAreaUnit} onChange={(e) => set("landAreaUnit", e.target.value as VentureFormValues["landAreaUnit"])}>
              <option value="acres">acres</option>
              <option value="hectares">hectares</option>
              <option value="sq_yards">sq yards</option>
              <option value="sq_meters">sq metres</option>
            </select>
          </div>
        </Field>
        {text("declaredTotalPlots", "Declared total plots", { inputMode: "numeric" }, "As declared by the developer; the inventory count is shown separately.")}
        <div className="sm:col-span-2">
          <Field label="Roads" htmlFor="vf-roads" error={fe("roadsDescription")}>
            <textarea id="vf-roads" className="input" rows={2} maxLength={1000} value={v.roadsDescription} placeholder="e.g. 60 ft main road, 40 ft internal roads" onChange={(e) => set("roadsDescription", e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Amenities" htmlFor="vf-amenities" error={fe("amenities")} hint="Press Enter or comma to add. Up to 40.">
            <TagInput id="vf-amenities" value={v.amenities} onChange={(a) => set("amenities", a)} placeholder="Add an amenity" suggestions={AMENITY_SUGGESTIONS} />
          </Field>
        </div>
      </Section>

      <Section icon={<Rocket size={18} />} title="Launch & visibility">
        {text("launchDate", "Launch date", { type: "date" })}
        <Field label="Status" htmlFor="vf-status" error={fe("status")}>
          <select id="vf-status" className="input" value={v.status} onChange={(e) => set("status", e.target.value as VentureFormValues["status"])}>
            {["draft", "upcoming", "launched", "sold_out", "on_hold", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:border-gold">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--gold)]" checked={v.isPublished} onChange={(e) => set("isPublished", e.target.checked)} />
            <span>
              <span className="font-semibold">Published</span>
              <span className="block text-sm text-muted">Customers can browse the venture, its 3D layout, images, layout PDF and model. CAD files are never public.</span>
            </span>
          </label>
        </div>
      </Section>

      <Section icon={<Clock size={18} />} title="Booking overrides" subtitle="Leave empty to use the organization defaults.">
        {text("holdMinutes", "Hold duration (minutes)", { inputMode: "numeric", placeholder: "Org default" }, "1–1440 minutes")}
        {text("bookingAmountPercent", "Booking amount (%)", { inputMode: "decimal", placeholder: "Org default" }, "Advance as a % of the net price (0–100]")}
      </Section>

      <Section icon={<Box size={18} />} title="3D viewer">
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          {([
            ["procedural", "Procedural", "Plots are extruded from plot geometry polygons (generated, DXF or manual)."],
            ["glb", "GLB model", "Uses the venture's uploaded GLB; meshes are matched to plots by mesh id."],
          ] as const).map(([val, label, desc]) => (
            <label key={val} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${v.viewerMode === val ? "border-gold bg-gold-soft/40" : "border-border"}`}>
              <input type="radio" name="viewerMode" className="mt-1 accent-[var(--gold)]" checked={v.viewerMode === val} onChange={() => set("viewerMode", val)} />
              <span><span className="font-semibold">{label}</span><span className="block text-sm text-muted">{desc}</span></span>
            </label>
          ))}
        </div>
        {v.viewerMode === "glb" && <div className="sm:col-span-2"><Notice tone="info">Upload a GLB on the Assets page and set it as the venture model. Until then the viewer falls back to procedural mode.</Notice></div>}
        <p className="text-sm text-muted sm:col-span-2">
          Opening view, hologram / realistic style, cinematic tour, sky, land pattern and venture theme are set under{" "}
          {mode === "edit" && ventureId
            ? <Link className="font-semibold text-primary hover:underline" href={`/ventures/${ventureId}/edit/presentation`}>Viewer &amp; presentation</Link>
            : <strong>Viewer &amp; presentation</strong>}
          {mode === "create" ? " after the venture is created." : "."}
        </p>
      </Section>

      {error && <Notice tone="danger">{error}</Notice>}
      {saved && <Notice tone="success">Venture saved.</Notice>}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" variant="gold" disabled={busy || v.name.trim().length < 2 || !v.code || !v.slug}>
          {busy ? "Saving…" : mode === "create" ? "Create venture" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
