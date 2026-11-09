"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, CardHeader, Field, Notice } from "@/components/ui";
import { PROPERTY_TYPES } from "@/lib/viewer-settings";

export interface PlotEditValues {
  version: number;
  plotNumber: string;
  phaseId: string;
  areaSqYards: string;
  lengthFt: string;
  widthFt: string;
  dimensionsText: string;
  facing: string;
  roadWidthFt: string;
  isCorner: boolean;
  basePricePerSqYard: string;
  notes: string;
  /** "" = inherit the venture's property type. Undefined = not supplied (loaded on mount). */
  propertyType?: string;
}

const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"];

export function PlotEditForm({ plotId, initial, phases, engineStatus, hasBookings, venturePropertyType }: {
  plotId: string;
  initial: PlotEditValues;
  phases: { id: string; code: string; name: string }[];
  engineStatus: string | null;
  hasBookings: boolean;
  /** The venture's property type (shown for the "inherit" option). Loaded on mount when not supplied. */
  venturePropertyType?: string | null;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [priceReason, setPriceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const priceChanged = Number(v.basePricePerSqYard) !== Number(initial.basePricePerSqYard);
  const set = <K extends keyof PlotEditValues>(k: K, val: PlotEditValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const [ventureType, setVentureType] = useState<string | null>(venturePropertyType ?? null);
  const [baseType, setBaseType] = useState<string | undefined>(initial.propertyType);

  // Older callers may not pass the property type: load it so saving never silently resets it.
  useEffect(() => {
    if (initial.propertyType !== undefined && venturePropertyType !== undefined) return;
    let cancelled = false;
    api<{ plot: { property_type: string | null; venture_property_type: string | null } }>(`/api/plots/${plotId}`)
      .then((r) => {
        if (cancelled) return;
        setVentureType(r.plot.venture_property_type ?? null);
        if (initial.propertyType === undefined) {
          const own = r.plot.property_type ?? "";
          setBaseType(own);
          setV((p) => (p.propertyType === undefined ? { ...p, propertyType: own } : p));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [plotId, initial.propertyType, venturePropertyType]);
  const typeLabel = (id: string | null | undefined) => PROPERTY_TYPES.find((t) => t.id === id)?.label ?? id ?? "venture default";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErrors({});
    const n = (s: string) => (s.trim() === "" ? null : Number(s));
    try {
      await api(`/api/plots/${plotId}`, {
        method: "PUT",
        body: {
          version: v.version, plotNumber: v.plotNumber, phaseId: v.phaseId || null, areaSqYards: Number(v.areaSqYards), lengthFt: n(v.lengthFt), widthFt: n(v.widthFt),
          dimensionsText: v.dimensionsText || null, facing: v.facing || null, roadWidthFt: n(v.roadWidthFt), isCorner: v.isCorner,
          basePricePerSqYard: Number(v.basePricePerSqYard), priceReason: priceChanged ? priceReason : null, notes: v.notes || null,
          ...(v.propertyType !== undefined && v.propertyType !== baseType ? { propertyType: v.propertyType || null } : {}),
        },
      });
      setMsg({ ok: true, text: "Plot saved." });
      setPriceReason("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
      }
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof PlotEditValues, label: string, extra: { inputMode?: "decimal" | "numeric"; disabled?: boolean; hint?: string } = {}) => (
    <Field label={label} htmlFor={`pe-${k}`} error={errors[k]} hint={extra.hint}>
      <input id={`pe-${k}`} className="input" value={String(v[k])} inputMode={extra.inputMode} disabled={extra.disabled} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );

  return (
    <Card>
      <CardHeader title="Edit plot" subtitle="Changes are audited. Status is managed by block/unblock and the booking engine." />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        {engineStatus && (
          <div className="sm:col-span-2">
            <Notice tone="info">This plot is {engineStatus}. Edits never change its status or the price captured in existing bookings/holds.</Notice>
          </div>
        )}
        {input("plotNumber", "Plot number", { disabled: hasBookings, hint: hasBookings ? "Locked — the plot has booking history" : undefined })}
        <Field label="Phase / block" htmlFor="pe-phase">
          <select id="pe-phase" className="input" value={v.phaseId} onChange={(e) => set("phaseId", e.target.value)}>
            <option value="">—</option>
            {phases.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </Field>
        {input("areaSqYards", "Area (sq yd)", { inputMode: "decimal" })}
        {input("roadWidthFt", "Road width (ft)", { inputMode: "decimal" })}
        {input("widthFt", "Width / frontage (ft)", { inputMode: "decimal" })}
        {input("lengthFt", "Length / depth (ft)", { inputMode: "decimal" })}
        {input("dimensionsText", "Dimensions label", { hint: "Leave empty to generate from width × length" })}
        <Field label="Facing" htmlFor="pe-facing">
          <select id="pe-facing" className="input" value={v.facing} onChange={(e) => set("facing", e.target.value)}>
            <option value="">—</option>
            {FACINGS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Property type" htmlFor="pe-ptype" error={errors.propertyType} hint={v.propertyType ? "Overrides the venture's property type for this plot" : "Inherits the venture's property type"}>
          <select id="pe-ptype" className="input" value={v.propertyType ?? ""} disabled={v.propertyType === undefined} onChange={(e) => set("propertyType", e.target.value)}>
            <option value="">Inherit from venture ({typeLabel(ventureType)})</option>
            {PROPERTY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <div />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.isCorner} onChange={(e) => set("isCorner", e.target.checked)} /> Corner plot
        </label>
        {input("basePricePerSqYard", "List price (₹ / sq yd)", { inputMode: "decimal" })}
        {priceChanged ? (
          <Field label="Reason for price change" htmlFor="pe-reason" hint="Recorded in price history and the audit log">
            <input id="pe-reason" className="input" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} />
          </Field>
        ) : <div />}
        <div className="sm:col-span-2">
          <Field label="Internal notes" htmlFor="pe-notes">
            <textarea id="pe-notes" className="input" rows={2} maxLength={2000} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        {msg && <div className="sm:col-span-2"><Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice></div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => { setV({ ...initial, propertyType: baseType }); setMsg(null); }}>Reset</Button>
          <Button type="submit" disabled={busy || (priceChanged && priceReason.trim().length < 3)}>{busy ? "Saving…" : "Save plot"}</Button>
        </div>
      </form>
    </Card>
  );
}
