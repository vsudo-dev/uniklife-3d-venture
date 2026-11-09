"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch, Wand2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Notice, PlotStatusBadge } from "@/components/ui";

export interface MeshRow {
  plotId: string;
  plotNumber: string;
  status: string;
  meshId: string | null;
  source: string | null;
  hasPolygon: boolean;
  suggested: string;
}

/** Lists mesh names in a GLB the same way the 3D viewer sees them (three.js Mesh objects). */
async function loadGlbMeshNames(url: string): Promise<string[]> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  const names = new Set<string>();
  gltf.scene.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh && o.name) names.add(o.name);
  });
  return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function MeshMapping({ ventureId, rows, modelUrl, viewerMode, canEdit }: {
  ventureId: string;
  rows: MeshRow[];
  modelUrl: string | null;
  viewerMode: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [glbNames, setGlbNames] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");

  const value = (r: MeshRow) => edits[r.plotId] ?? r.meshId ?? "";
  const dirty = Object.entries(edits).filter(([id, v]) => (rows.find((r) => r.plotId === id)?.meshId ?? "") !== v.trim());
  const duplicates = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      const v = (edits[r.plotId] ?? r.meshId ?? "").trim();
      if (v) count.set(v, (count.get(v) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows, edits]);

  const validation = useMemo(() => {
    if (!glbNames) return null;
    const mapped = new Set(rows.map((r) => (edits[r.plotId] ?? r.meshId ?? "").trim()).filter(Boolean));
    const inGlb = new Set(glbNames);
    return {
      meshesWithoutPlot: glbNames.filter((n) => !mapped.has(n)),
      plotsWithoutMesh: rows.filter((r) => !inGlb.has((edits[r.plotId] ?? r.meshId ?? "").trim())).map((r) => r.plotNumber),
    };
  }, [glbNames, rows, edits]);

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setEdits({});
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function inspect() {
    if (!modelUrl) return;
    setBusy("inspect");
    setMsg(null);
    try {
      setGlbNames(await loadGlbMeshNames(modelUrl));
    } catch (e) {
      setMsg({ ok: false, text: `Could not read the GLB: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  const shown = rows.filter((r) => !filter || r.plotNumber.toLowerCase().includes(filter.toLowerCase()) || value(r).toLowerCase().includes(filter.toLowerCase()));
  const unmapped = rows.filter((r) => !r.meshId).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="3D mesh mapping"
        subtitle="Each plot's mesh id must equal the node name of its mesh in the GLB model. Unique per venture."
        action={<Badge tone={unmapped ? "warning" : "success"}>{unmapped ? `${unmapped} unmapped` : "all mapped"}</Badge>}
      />
      <div className="space-y-3 p-5">
        {viewerMode !== "glb" && <Notice tone="neutral">The viewer is in procedural mode; mesh ids are still used to identify plots and are required for GLB mode.</Notice>}
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Filter by plot or mesh" aria-label="Filter mesh mapping" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {canEdit && (
            <>
              <Button variant="outline" disabled={!!busy} onClick={() => run("auto", () => api(`/api/ventures/${ventureId}/mesh-mapping/auto`, { method: "POST", body: { overwrite: false } }), "Unmapped plots were auto-mapped")}>
                <Wand2 size={16} /> Auto-map unmapped (PLOT_###)
              </Button>
              <Button variant="ghost" disabled={!!busy}
                onClick={() => {
                  if (window.confirm("Overwrite ALL mesh ids with the PLOT_<number> convention?")) run("auto-all", () => api(`/api/ventures/${ventureId}/mesh-mapping/auto`, { method: "POST", body: { overwrite: true } }), "All plots re-mapped by convention");
                }}>
                Re-map all
              </Button>
            </>
          )}
          <Button variant="outline" disabled={!modelUrl || !!busy} onClick={inspect} title={modelUrl ? undefined : "Set a GLB as the venture's 3D model first"}>
            {busy === "inspect" ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />} Validate against GLB
          </Button>
        </div>
        {!modelUrl && <p className="text-xs text-muted">No GLB model is set for this venture — upload one and choose “Use as 3D model” to validate mesh names.</p>}
        {validation && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Notice tone={validation.meshesWithoutPlot.length ? "warning" : "success"} title={`GLB meshes without a plot (${validation.meshesWithoutPlot.length} of ${glbNames!.length})`}>
              {validation.meshesWithoutPlot.length ? validation.meshesWithoutPlot.slice(0, 60).join(", ") + (validation.meshesWithoutPlot.length > 60 ? " …" : "") : "Every mesh in the model maps to a plot."}
            </Notice>
            <Notice tone={validation.plotsWithoutMesh.length ? "warning" : "success"} title={`Plots without a mesh in the GLB (${validation.plotsWithoutMesh.length})`}>
              {validation.plotsWithoutMesh.length ? validation.plotsWithoutMesh.slice(0, 60).join(", ") + (validation.plotsWithoutMesh.length > 60 ? " …" : "") : "Every plot has a mesh in the model."}
            </Notice>
          </div>
        )}
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      </div>
      <div className="max-h-[480px] overflow-auto border-t border-border">
        <table className="table">
          <thead className="sticky top-0 z-10">
            <tr><th>Plot</th><th>Status</th><th>Mesh id</th><th>Geometry</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = value(r);
              const dup = v.trim() && duplicates.has(v.trim());
              const missing = glbNames && v.trim() && !glbNames.includes(v.trim());
              return (
                <tr key={r.plotId}>
                  <td className="font-semibold">{r.plotNumber}</td>
                  <td><PlotStatusBadge status={r.status} /></td>
                  <td className="min-w-[200px]">
                    {canEdit ? (
                      <input
                        className={`input py-1 font-mono text-xs ${dup ? "border-danger" : ""}`}
                        aria-label={`Mesh id for plot ${r.plotNumber}`}
                        aria-invalid={dup ? true : undefined}
                        value={v}
                        maxLength={128}
                        placeholder={r.suggested}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [r.plotId]: e.target.value }))}
                      />
                    ) : (
                      <code className="text-xs">{r.meshId ?? "—"}</code>
                    )}
                    {dup && <p className="mt-0.5 text-xs text-danger">Duplicate mesh id</p>}
                    {missing && <p className="mt-0.5 text-xs text-warning">Not found in GLB</p>}
                  </td>
                  <td className="text-xs text-muted">{r.hasPolygon ? `polygon (${r.source})` : r.meshId ? "mesh only" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          {dirty.length > 0 && <span className="text-sm text-muted">{dirty.length} unsaved change(s)</span>}
          <Button variant="ghost" disabled={!dirty.length || !!busy} onClick={() => setEdits({})}>Discard</Button>
          <Button
            variant="primary"
            disabled={!dirty.length || duplicates.size > 0 || dirty.some(([, v]) => !v.trim()) || !!busy}
            onClick={() => run("save", () => api(`/api/ventures/${ventureId}/mesh-mapping`, { method: "PUT", body: { items: dirty.map(([plotId, meshId]) => ({ plotId, meshId: meshId.trim() })) } }), "Mesh mapping saved")}
          >
            Save mapping
          </Button>
        </div>
      )}
    </Card>
  );
}
