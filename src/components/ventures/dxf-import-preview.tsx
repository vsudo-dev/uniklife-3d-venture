"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import type { ImportPreview } from "@/lib/cad/import";
import { Badge, Button, Card, CardHeader, Notice, Stat } from "@/components/ui";

const FEATURE_FILL: Record<string, string> = { road: "#3a3f4b", park: "#2f7d4a", amenity: "#b08d2a", boundary: "none", entrance: "#c9a227", water: "#2a6fb0" };

function PreviewSvg({ preview }: { preview: ImportPreview }) {
  const all = [...preview.polygons.flatMap((p) => p.points), ...preview.features.flatMap((f) => f.points)];
  if (!all.length) return null;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const pad = Math.max(w, h) * 0.03;
  const pts = (ps: [number, number][]) => ps.map(([x, y]) => `${x - minX + pad},${maxY - y + pad}`).join(" ");
  const stroke = Math.max(w, h) / 500;
  return (
    <svg viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`} className="h-auto max-h-[420px] w-full rounded-xl bg-[#0a1430]" role="img" aria-label="Preview of detected outlines">
      {preview.features.map((f) => (
        <polygon key={`f${f.index}`} points={pts(f.points)} fill={FEATURE_FILL[f.kind] ?? "#555"} fillOpacity={0.6} stroke="#9aa8d6" strokeWidth={stroke} strokeDasharray={f.kind === "boundary" ? `${stroke * 6}` : undefined} />
      ))}
      {preview.polygons.map((p) => {
        const color = !p.applicable ? "#dc2626" : p.deviationFlag ? "#eab308" : "#16a34a";
        return (
          <g key={p.index}>
            <polygon points={pts(p.points)} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={stroke} />
            {p.plotNumber && (
              <text x={p.centroid[0] - minX + pad} y={maxY - p.centroid[1] + pad} fontSize={Math.max(w, h) / 70} fill="#fff" textAnchor="middle" dominantBaseline="middle">
                {p.plotNumber}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function DxfImportPreview({ ventureId, assetId, preview }: { ventureId: string; assetId: string; preview: ImportPreview }) {
  const router = useRouter();
  const [opts, setOpts] = useState({ acceptDeviations: false, importFeatures: preview.features.length > 0, replaceFeatures: true, normalizeOrigin: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const deviating = preview.polygons.filter((p) => p.applicable && p.deviationFlag);
  const rows = useMemo(() => (onlyIssues ? preview.polygons.filter((p) => p.issues.length) : preview.polygons), [preview.polygons, onlyIssues]);

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ applied: number; features: number }>(`/api/ventures/${ventureId}/dxf-import/apply`, { method: "POST", body: { assetId, ...opts } });
      setMsg({ ok: true, text: `Geometry applied to ${res.applied} plot(s)${res.features ? ` and ${res.features} feature(s)` : ""}. Verify it in the 3D viewer against the approved survey drawing.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Outlines detected" value={preview.summary.detected} hint={`units: ${preview.unitName}`} />
        <Stat label="Matched" value={preview.summary.matched} hint={preview.matchMode === "order" ? "by order" : "by label"} />
        <Stat label="Ready to apply" value={preview.summary.applicable} accent="gold" />
        <Stat label="Area deviations" value={preview.summary.deviations} hint="> 3 % vs recorded" />
        <Stat label="Unmatched plots" value={preview.unmatchedPlots.length} />
      </div>

      <Notice tone="warning" title="Geometry verification">
        Imported geometry must be checked against the approved survey drawings. Areas are computed from the drawing and compared with each plot&apos;s recorded area;
        deviations above 3 % are flagged and must be explicitly accepted.
      </Notice>
      {preview.warnings.map((w) => <Notice key={w} tone="info">{w}</Notice>)}
      {preview.openPolylines > 0 && <Notice tone="neutral">{preview.openPolylines} open polyline(s) were ignored (only closed outlines are imported).</Notice>}

      <Card className="overflow-hidden">
        <CardHeader title="Drawing preview" subtitle="Green: ready · Yellow: area deviation · Red: conflict (not applied)" />
        <div className="p-4"><PreviewSvg preview={preview} /></div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Detected outlines"
          action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only issues</label>}
        />
        <div className="max-h-[520px] overflow-auto">
          <table className="table">
            <thead className="sticky top-0"><tr><th>#</th><th>Layer</th><th>Label(s)</th><th>Plot</th><th className="text-right">DXF area (sq yd)</th><th className="text-right">Recorded</th><th className="text-right">Deviation</th><th>Issues</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.index}>
                  <td className="text-xs text-muted">{p.index + 1}</td>
                  <td className="text-xs">{p.layer}</td>
                  <td className="text-xs">{p.labels.join(" / ") || "—"}</td>
                  <td>{p.plotNumber ? <span className="font-semibold">{p.plotNumber}</span> : "—"}{p.matchedBy === "order" && <Badge tone="warning" className="ml-1">by order</Badge>}</td>
                  <td className="text-right">{p.areaSqYards.toLocaleString("en-IN")}</td>
                  <td className="text-right">{p.recordedAreaSqYards?.toLocaleString("en-IN") ?? "—"}</td>
                  <td className={`text-right ${p.deviationFlag ? "font-semibold text-warning" : ""}`}>{p.deviationPct === null ? "—" : `${p.deviationPct}%`}</td>
                  <td className="text-xs">
                    {p.applicable && !p.issues.length ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={14} /> OK</span> : (
                      <ul className="space-y-0.5">
                        {p.issues.map((i) => <li key={i} className={p.applicable ? "text-warning" : "text-danger"}>{i}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Plots without an outline (${preview.unmatchedPlots.length})`} subtitle="Their existing geometry is left unchanged." />
          <p className="p-5 text-sm">{preview.unmatchedPlots.length ? preview.unmatchedPlots.map((p) => p.plotNumber).join(", ") : "Every plot has a matching outline."}</p>
        </Card>
        <Card>
          <CardHeader title={`Roads & amenities (${preview.features.length})`} subtitle="From layers named like ROAD, PARK, AMENITY, BOUNDARY, ENTRANCE, WATER." />
          <ul className="space-y-1 p-5 text-sm">
            {preview.features.length ? preview.features.map((f) => <li key={f.index}><Badge>{f.kind}</Badge> {f.name ?? f.layer} <span className="text-muted">· {f.areaSqM.toLocaleString("en-IN")} m²</span></li>) : <li className="text-muted">None detected.</li>}
            {preview.ignored.length > 0 && <li className="pt-2 text-xs text-muted">{preview.ignored.length} outline(s) on non-plot layers ignored.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Apply geometry" subtitle="Writes plot outlines (source: dxf) in one transaction with an audit log entry. Existing mesh ids are kept; new ones default to PLOT_<number>." />
        <div className="space-y-3 p-5 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={opts.normalizeOrigin} onChange={(e) => setOpts({ ...opts, normalizeOrigin: e.target.checked })} />
            <span>Move the drawing so its lower-left corner is at (0, 0) — recommended for survey-grid coordinates.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={!preview.features.length} checked={opts.importFeatures} onChange={(e) => setOpts({ ...opts, importFeatures: e.target.checked })} />
            <span>Import roads / amenities into the viewer ({preview.features.length})</span></label>
          {opts.importFeatures && (
            <label className="ml-6 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={opts.replaceFeatures} onChange={(e) => setOpts({ ...opts, replaceFeatures: e.target.checked })} />
              <span>Replace the venture&apos;s existing roads/amenities (recommended — they use a different coordinate frame)</span></label>
          )}
          {deviating.length > 0 && (
            <label className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] p-3">
              <input type="checkbox" className="mt-1" checked={opts.acceptDeviations} onChange={(e) => setOpts({ ...opts, acceptDeviations: e.target.checked })} />
              <span><AlertTriangle size={14} className="mr-1 inline text-warning" />I have reviewed the {deviating.length} plot(s) whose drawn area deviates more than 3 % from the recorded area ({deviating.slice(0, 12).map((d) => d.plotNumber).join(", ")}{deviating.length > 12 ? " …" : ""}) and want to apply them anyway. Recorded areas are not changed.</span>
            </label>
          )}
          {msg && <Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice>}
          <div className="flex justify-end">
            <Button variant="gold" disabled={busy || preview.summary.applicable === 0 || (deviating.length > 0 && !opts.acceptDeviations)} onClick={apply}>
              {busy ? "Applying…" : `Apply geometry to ${preview.summary.applicable} plot(s)`}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
