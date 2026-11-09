"use client";

import { useState } from "react";
import { Download, FileUp, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Notice } from "@/components/ui";
import { MessageLine, useAction } from "./use-action";

interface PreviewRow {
  line: number;
  fullName: string;
  mobile: string | null;
  email: string | null;
  designation: string | null;
  commissionLevel: number | null;
  managerRef: string | null;
  hrmReference: string | null;
  joiningDate: string | null;
  errors: string[];
}

export function EmployeeImport({ canApprove }: { canApprove: boolean }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; valid: number; invalid: number; csv: string } | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);
  const { busy, msg, run, setMsg } = useAction();

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) return void setMsg({ tone: "err", text: "CSV is too large (max 2 MB)" });
    setCsv(await f.text());
    setPreview(null);
    setCreated(null);
  }

  async function doPreview() {
    setCreated(null);
    const r = await run("preview", () => api<{ rows: PreviewRow[]; valid: number; invalid: number }>("/api/employees/import/preview", { body: { csv } }));
    if (r) setPreview({ ...r, csv });
  }

  async function doCommit() {
    if (!preview) return;
    const r = await run(
      "commit",
      () => api<{ created: string[] }>("/api/employees/import/commit", { body: { csv: preview.csv, approve: true } }),
      (res) => `Imported ${res.created.length} employees`,
    );
    if (r) {
      setCreated(r.created);
      setPreview(null);
      setCsv("");
    }
  }

  const stale = preview && preview.csv !== csv;

  return (
    <Card>
      <CardHeader
        title="Administrator-approved CSV import"
        subtitle="Upload or paste a CSV, review the dry-run preview, then approve. Nothing is written until an organization administrator approves."
        action={
          <a href="/api/employees/import/template" download className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:border-gold">
            <Download size={14} aria-hidden /> Template
          </a>
        }
      />
      <div className="space-y-4 p-5">
        <Notice tone="info" title="HRM sync">
          Automatic HRM synchronisation requires a verified UNIKLIFE.AI HRM integration, which is not assumed to exist. Use this import to map records manually; employee IDs are generated automatically.
        </Notice>
        <div className="text-xs text-muted">
          Columns: <code className="rounded bg-surface-2 px-1">full_name, mobile, email, designation, commission_level, manager_ref, hrm_reference, joining_date</code>.{" "}
          <code className="rounded bg-surface-2 px-1">manager_ref</code> is an existing employee ID / HRM reference, or the hrm_reference of a row earlier in the file. Dates use YYYY-MM-DD.
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-5 text-sm font-semibold text-muted hover:border-gold">
          <FileUp size={18} aria-hidden /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div>
          <label className="label" htmlFor="import-csv">…or paste CSV</label>
          <textarea id="import-csv" className="input font-mono text-xs" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="full_name,mobile,email,designation,commission_level,manager_ref,hrm_reference,joining_date" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!!busy || csv.trim().length === 0} onClick={doPreview}>{busy === "preview" ? "Checking…" : "Preview import"}</Button>
          {preview && canApprove && (
            <Button variant="gold" disabled={!!busy || preview.invalid > 0 || preview.rows.length === 0 || !!stale} onClick={doCommit}>
              <ShieldCheck size={16} aria-hidden /> {busy === "commit" ? "Importing…" : `Approve & import ${preview.valid} rows`}
            </Button>
          )}
          <MessageLine msg={msg} />
        </div>
        {preview && !canApprove && <Notice tone="warning">Only an organization administrator can approve an import.</Notice>}
        {stale && <Notice tone="warning">The CSV changed since the preview — preview again before importing.</Notice>}
        {preview && (
          <div>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              <Badge tone="success">{preview.valid} valid</Badge>
              <Badge tone={preview.invalid ? "danger" : "neutral"}>{preview.invalid} with errors</Badge>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="table min-w-[860px]">
                <thead>
                  <tr><th>Line</th><th>Name</th><th>Mobile</th><th>Email</th><th>Designation</th><th>Level</th><th>Manager ref</th><th>HRM ref</th><th>Joining</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.errors.length ? "bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]" : undefined}>
                      <td className="tabular-nums">{r.line}</td>
                      <td className="font-semibold">{r.fullName || "—"}</td>
                      <td>{r.mobile ?? "—"}</td>
                      <td>{r.email ?? "—"}</td>
                      <td>{r.designation ?? "—"}</td>
                      <td>{r.commissionLevel ?? "—"}</td>
                      <td>{r.managerRef ?? "—"}</td>
                      <td>{r.hrmReference ?? "—"}</td>
                      <td>{r.joiningDate ?? "—"}</td>
                      <td>
                        {r.errors.length === 0 ? <Badge tone="success">ok</Badge> : (
                          <ul className="space-y-0.5 text-xs text-danger">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {created && created.length > 0 && (
          <Notice tone="success" title="Import complete">
            Created employee IDs: {created.join(", ")}
          </Notice>
        )}
      </div>
    </Card>
  );
}
