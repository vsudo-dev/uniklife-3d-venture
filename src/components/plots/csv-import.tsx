"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { api } from "@/lib/client/api";
import type { CsvImportPreview } from "@/lib/services/plots";
import { Badge, Button, Card, CardHeader, Notice, PlotStatusBadge, Stat } from "@/components/ui";
import { PROPERTY_TYPES } from "@/lib/viewer-settings";

const TEMPLATE = "plot_number,phase,area_sq_yards,length_ft,width_ft,facing,road_width_ft,is_corner,base_price_per_sq_yard,property_type\r\n101,A,166.67,50,30,E,40,no,18000,\r\n102,A,200,50,36,N,40,yes,19500,villa_plot\r\n";
const ACTION_TONE = { create: "success", update: "info", unchanged: "neutral", error: "danger" } as const;

interface PdfExtract { csv: string; rows: number; method: "text" | "ai" | "reviewed_layout"; warnings: string[]; fileName: string; aiOffered: boolean }

export function CsvImport({ ventureId, ventureName, pdfs = [], aiAvailable = false }: { ventureId: string; ventureName: string; pdfs?: { id: string; name: string }[]; aiAvailable?: boolean }) {
  const router = useRouter();
  const [pdfNote, setPdfNote] = useState<{ tone: "info" | "warning" | "danger"; text: string; assetId?: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const fromPdf=useCallback(async (assetId: string, useAi = false) => {
    setPdfBusy(true);
    setPdfNote(null);
    try {
      const r = await api<PdfExtract>("/api/plots/import/pdf", { method: "POST", body: { ventureId, assetId, useAi } });
      if (r.rows) {
        setCsv(r.csv); setFileName(r.fileName); setPreview(null); setMsg(null);
        setPdfNote({ tone: r.warnings.length ? "warning" : "info", text: `Read ${r.rows} plot row(s) from ${r.fileName} (${r.method === "ai" ? "AI" : r.method === "reviewed_layout" ? "reviewed layout" : "PDF text"}). Review below, then Preview & validate — nothing is imported yet. ${r.warnings.join(" ")}` });
      } else {
        setPdfNote({ tone: "warning", text: `No plot table could be read from ${r.fileName}. ${r.warnings.join(" ")}${r.aiOffered ? " You can try AI extraction." : ""}`, assetId: r.aiOffered ? assetId : undefined });
      }
    } catch (e) {
      setPdfNote({ tone: "danger", text: (e as Error).message });
    } finally {
      setPdfBusy(false);
    }
  }, [ventureId]);

  // A venture with exactly one attached PDF is read automatically on arrival.
  const autoRan = useRef(false);
  useEffect(() => {
    if(autoRan.current)return;
    const saved=sessionStorage.getItem(`venture-csv:${ventureId}`);
    if(saved){autoRan.current=true;setCsv(saved);setFileName("Uploaded venture inventory.csv");sessionStorage.removeItem(`venture-csv:${ventureId}`);return;}
    if(pdfs.length!==1)return;
    autoRan.current = true;
    void fromPdf(pdfs[0].id);
  }, [ventureId,pdfs,fromPdf]);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function load(file: File) {
    if (file.size > 5 * 1024 * 1024) return setMsg({ ok: false, text: "CSV files are limited to 5 MB." });
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setMsg(null);
  }

  async function run(mode: "preview" | "apply") {
    setBusy(mode);
    setMsg(null);
    try {
      if (mode === "preview") {
        setPreview(await api<CsvImportPreview>("/api/plots/import", { method: "POST", body: { ventureId, csv, mode } }));
      } else {
        const r = await api<{ created: number; updated: number; unchanged: number; newPhases: string[] }>("/api/plots/import", { method: "POST", body: { ventureId, csv, mode } });
        setMsg({ ok: true, text: `Import complete: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged${r.newPhases.length ? `; new phases ${r.newPhases.join(", ")}` : ""}.` });
        setPreview(null);
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => r.action !== "unchanged")) : [];
  const blocking = preview ? preview.summary.error > 0 || preview.headerErrors.some((e) => !e.startsWith("Unknown column")) : true;

  return (
    <div className="space-y-5">
      {(
        <Card>
          <CardHeader title="Plot inventory from venture PDF" subtitle="PDFs attached to this venture are read into the table below. You always review and confirm before anything is imported." />
          <div className="space-y-3 p-5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold">
              <FileUp size={16} /> Upload layout PDF
              <input type="file" accept=".pdf,application/pdf" className="sr-only" disabled={pdfBusy} onChange={async e=>{
                const file=e.target.files?.[0];if(!file)return;
                setPdfBusy(true);setPdfNote(null);
                try {
                  const form=new FormData();form.set("kind","layout_pdf");form.set("file",file);
                  const res=await fetch(`/api/ventures/${ventureId}/assets`,{method:"POST",body:form});
                  const result=await res.json();if(!res.ok)throw new Error(result.error?.message ?? "PDF upload failed");
                  await fromPdf(result.asset.id);router.refresh();
                }catch(err){setPdfNote({tone:"danger",text:(err as Error).message});}finally{setPdfBusy(false);e.target.value="";}
              }}/>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {pdfs.map((p) => <Button key={p.id} variant="outline" disabled={pdfBusy} onClick={() => fromPdf(p.id)}>{pdfBusy ? "Reading…" : `Read ${p.name}`}</Button>)}
            </div>
            {pdfNote && (
              <Notice tone={pdfNote.tone}>
                {pdfNote.text}
                {pdfNote.assetId && aiAvailable && <Button className="ml-3" variant="gold" disabled={pdfBusy} onClick={() => fromPdf(pdfNote.assetId!, true)}>Try AI extraction</Button>}
              </Notice>
            )}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title={`Review inventory for ${ventureName}`} subtitle="Rows match by plot number. Mortgage plots become blocked; booking statuses are preserved. Review and confirm before importing." />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-gold">
              <FileUp size={16} /> Choose CSV file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            </label>
            {fileName && <span className="text-sm text-muted">{fileName}</span>}
            <a className="text-sm text-primary underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="plot-import-template.csv">Download template</a>
          </div>
          <div>
            <label className="label" htmlFor="csv-text">…or paste CSV</label>
            <textarea id="csv-text" className="input font-mono text-xs" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={TEMPLATE} />
          </div>
          <p className="text-xs text-muted">
            Columns: <code>plot_number</code> (required), <code>phase</code>, <code>area_sq_yards</code>, <code>length_ft</code>, <code>width_ft</code>, <code>facing</code> (N/S/E/W/NE/NW/SE/SW),
            <code> road_width_ft</code>, <code>is_corner</code> (yes/no), <code>base_price_per_sq_yard</code>, <code>property_type</code> ({PROPERTY_TYPES.map((t) => t.id).join(" / ")}, or <code>inherit</code> to use the venture&apos;s type). Mortgage fields: is_mortgaged (yes/no), mortgage_reference (document label). Mortgage plots import as blocked; CSV cannot release a mortgage. New plots need area and price. Empty cells leave existing values unchanged.
            Unknown phase codes create new phases. Price changes are written to price history; existing bookings keep their snapshot.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!csv.trim() || !!busy} onClick={() => run("preview")}>{busy === "preview" ? "Validating…" : "Preview & validate"}</Button>
          </div>
          {msg && <Notice tone={msg.ok ? "success" : "danger"}>{msg.text}</Notice>}
        </div>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Rows" value={preview.summary.total} />
            <Stat label="New" value={preview.summary.create} />
            <Stat label="Updates" value={preview.summary.update} accent="gold" />
            <Stat label="Unchanged" value={preview.summary.unchanged} />
            <Stat label="Errors" value={preview.summary.error} />
          </div>
          {preview.headerErrors.map((e) => <Notice key={e} tone={e.startsWith("Unknown column") ? "warning" : "danger"}>{e}</Notice>)}
          {preview.newPhases.length > 0 && <Notice tone="info">New phases will be created: {preview.newPhases.join(", ")}</Notice>}
          <Card className="overflow-hidden">
            <CardHeader title="Preview" action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show unchanged</label>} />
            <div className="max-h-[520px] overflow-auto">
              <table className="table">
                <thead className="sticky top-0"><tr><th>Line</th><th>Plot</th><th>Action</th><th>Status</th><th>Changes</th><th>Messages</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line}>
                      <td className="text-xs text-muted">{r.line}</td>
                      <td className="font-semibold">{r.plotNumber || "—"}</td>
                      <td><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></td>
                      <td>{r.currentStatus ? <PlotStatusBadge status={r.currentStatus} /> : <span className="text-xs text-muted">new → {r.data.isMortgaged ? "mortgage blocked" : "available"}</span>}</td>
                      <td className="text-xs">
                        {Object.entries(r.changes).map(([k, c]) => <div key={k}><span className="text-muted">{k}:</span> {String(c.from ?? "—")} → <strong>{String(c.to ?? "—")}</strong></div>)}
                      </td>
                      <td className="text-xs">
                        {r.errors.map((e) => <div key={e} className="text-danger">{e}</div>)}
                        {r.warnings.map((w) => <div key={w} className="text-warning">{w}</div>)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Nothing to change.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex justify-end">
            <Button variant="gold" disabled={blocking || !!busy || preview.summary.create + preview.summary.update === 0} onClick={() => run("apply")}>
              {busy === "apply" ? "Importing…" : `Apply import (${preview.summary.create} new, ${preview.summary.update} updates)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
