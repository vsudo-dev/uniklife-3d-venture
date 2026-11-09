"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Box, FileImage, FileText, FileWarning, Loader2, PenTool, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, EmptyState, Notice } from "@/components/ui";

export interface AssetItem {
  id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_name: string | null;
}

const KINDS = [
  { value: "image", label: "Venture image (PNG, JPEG, WebP)", accept: "image/png,image/jpeg,image/webp" },
  { value: "layout_pdf", label: "Layout PDF", accept: "application/pdf,.pdf" },
  { value: "model_glb", label: "3D model (GLB only)", accept: ".glb,model/gltf-binary" },
  { value: "cad_dxf", label: "CAD drawing — DXF (ASCII)", accept: ".dxf" },
  { value: "cad_dwg", label: "CAD drawing — DWG (archive only)", accept: ".dwg" },
] as const;

const KIND_LABEL: Record<string, string> = { image: "Image", layout_pdf: "Layout PDF", model_glb: "GLB model", cad_dxf: "DXF", cad_dwg: "DWG", document: "Document" };

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <FileImage size={18} />;
  if (kind === "layout_pdf") return <FileText size={18} />;
  if (kind === "model_glb") return <Box size={18} />;
  if (kind === "cad_dwg") return <FileWarning size={18} />;
  return <PenTool size={18} />;
}

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AssetManager({ ventureId, assets, roles, maxUploadMb, canManagePlots }: {
  ventureId: string;
  assets: AssetItem[];
  roles: { coverImage: string | null; layoutPdf: string | null; model: string | null };
  maxUploadMb: number;
  canManagePlots: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("image");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMsg({ ok: false, text: "Choose a file first." });
    if (file.size > maxUploadMb * 1024 * 1024) return setMsg({ ok: false, text: `File exceeds the ${maxUploadMb} MB limit.` });
    setBusy("upload");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const res = await fetch(`/api/ventures/${ventureId}/assets`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
      setMsg({ ok: true, text: kind === "cad_dwg" ? "DWG archived. DWG cannot be parsed directly — upload a DXF export to import geometry." : `Uploaded ${file.name}.` });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const setRole = (role: "cover_image" | "layout_pdf" | "model", assetId: string | null, ok: string) =>
    run(`${role}:${assetId}`, () => api(`/api/ventures/${ventureId}/assets/roles`, { method: "POST", body: { role, assetId } }), ok);

  const accept = KINDS.find((k) => k.value === kind)!.accept;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Upload" subtitle={`File type is verified from its content (magic bytes), not its name. Max ${maxUploadMb} MB.`} />
        <form onSubmit={upload} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="asset-kind">File kind</label>
            <select id="asset-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="asset-file">File</label>
            <input id="asset-file" ref={fileRef} type="file" accept={accept} className="input file:mr-3 file:rounded-lg file:border-0 file:bg-gold-soft file:px-3 file:py-1 file:text-sm file:font-semibold" />
          </div>
          <Button type="submit" variant="gold" disabled={busy === "upload"}>
            {busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
          </Button>
          {kind === "cad_dwg" && (
            <div className="sm:col-span-3">
              <Notice tone="warning" title="DWG is archived only">
                DWG cannot be parsed directly; export to DXF (R12/R2000 ASCII) from your CAD tool and upload the DXF.
              </Notice>
            </div>
          )}
          {kind === "model_glb" && (
            <div className="sm:col-span-3">
              <Notice tone="info">Only binary glTF 2.0 (.glb with embedded buffers). Name each plot mesh like <code>PLOT_001</code> so it can be auto-mapped to plots.</Notice>
            </div>
          )}
        </form>
        {msg && <p role="status" className={`px-5 pb-4 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Venture files" subtitle="Images, the layout PDF and the GLB model are visible to customers when the venture is published. CAD files are staff-only." />
        {assets.length === 0 ? (
          <EmptyState title="No files uploaded yet" />
        ) : (
          <ul className="divide-y divide-border">
            {assets.map((a) => {
              const isCover = roles.coverImage === a.id;
              const isLayout = roles.layoutPdf === a.id;
              const isModel = roles.model === a.id;
              const href = `/api/ventures/${ventureId}/assets/${a.id}`;
              return (
                <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"><KindIcon kind={a.kind} /></span>
                    <div className="min-w-0">
                      <a href={href} target="_blank" rel="noopener" className="block truncate font-semibold text-primary hover:underline">{a.file_name}</a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Badge>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                        <span>{size(a.size_bytes)}</span>
                        <span>· {new Date(a.created_at).toLocaleDateString("en-IN")}</span>
                        {a.uploaded_by_name && <span>· {a.uploaded_by_name}</span>}
                        {isCover && <Badge tone="gold">Cover image</Badge>}
                        {isLayout && <Badge tone="gold">Layout PDF</Badge>}
                        {isModel && <Badge tone="gold">3D model</Badge>}
                      </div>
                      {a.kind === "cad_dwg" && <p className="mt-1 text-xs text-warning">DWG cannot be parsed directly; export to DXF (R12/R2000 ASCII) from your CAD tool and upload the DXF.</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.kind === "image" && (isCover
                      ? <Button variant="ghost" disabled={!!busy} onClick={() => setRole("cover_image", null, "Cover image cleared")}>Clear cover</Button>
                      : <Button variant="outline" disabled={!!busy} onClick={() => setRole("cover_image", a.id, "Cover image set")}>Set as cover</Button>)}
                    {a.kind === "layout_pdf" && (isLayout
                      ? <Button variant="ghost" disabled={!!busy} onClick={() => setRole("layout_pdf", null, "Layout PDF cleared")}>Clear layout</Button>
                      : <Button variant="outline" disabled={!!busy} onClick={() => setRole("layout_pdf", a.id, "Layout PDF set")}>Set as layout PDF</Button>)}
                    {a.kind === "model_glb" && (isModel
                      ? <Button variant="ghost" disabled={!!busy} onClick={() => setRole("model", null, "3D model cleared")}>Clear model</Button>
                      : <Button variant="outline" disabled={!!busy} onClick={() => setRole("model", a.id, "3D model set — switch the viewer mode to GLB in the venture form to use it")}>Use as 3D model</Button>)}
                    {a.kind === "cad_dxf" && canManagePlots && (
                      <Link href={`/ventures/${ventureId}/assets/import?asset=${a.id}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-gold">
                        Preview geometry import
                      </Link>
                    )}
                    <Button variant="ghost" className="text-danger" aria-label={`Delete ${a.file_name}`} disabled={!!busy}
                      onClick={() => {
                        if (window.confirm(`Delete ${a.file_name}? This cannot be undone.`)) run(`del:${a.id}`, () => api(href, { method: "DELETE" }), "File deleted");
                      }}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
