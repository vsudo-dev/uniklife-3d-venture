"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cx } from "@/components/ui";

const STATUSES = ["new", "contacted", "qualified", "converted", "closed"] as const;
type Employee = { id: string; employee_code: string; full_name: string; designation: string | null };

/** Inline status change + assignment (only permitted employees are offered by the server). */
export function EnquiryControls({ id, status, assigned }: { id: string; status: string; assigned: { code: string | null; name: string | null } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Employee[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;
    const t = window.setTimeout(() => api<Employee[]>(`/api/employees/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 200);
    return () => window.clearTimeout(t);
  }, [q, picking]);

  useEffect(() => {
    if (!picking) return;
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setPicking(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picking]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/enquiries/${id}`, { method: "PATCH", body });
      setPicking(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select className="input py-1 text-xs" value={status} disabled={busy} onChange={(e) => patch({ status: e.target.value })} aria-label="Enquiry status">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {busy && <Loader2 size={14} className="animate-spin text-muted" />}
      </div>
      <div className="relative" ref={boxRef}>
        <button type="button" onClick={() => setPicking((p) => !p)} disabled={busy}
          className={cx("flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-xs", assigned.code ? "border-border" : "border-dashed border-gold text-gold-strong")}
          aria-expanded={picking} aria-haspopup="listbox">
          <UserRound size={12} />{assigned.code ? `${assigned.code} · ${assigned.name}` : "Assign…"}
        </button>
        {picking && (
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-border bg-surface p-2 shadow-xl">
            <input autoFocus className="input py-1.5 text-sm" placeholder="Search your team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
            <ul className="mt-1 max-h-56 overflow-y-auto" role="listbox">
              {results.map((e) => (
                <li key={e.id}>
                  <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" onClick={() => patch({ assignedEmployeeId: e.id })}>
                    <strong>{e.employee_code}</strong> · {e.full_name} <span className="text-muted">{e.designation}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-2 py-1.5 text-xs text-muted">No permitted employees match.</li>}
            </ul>
            {assigned.code && (
              <button type="button" className="mt-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-danger hover:bg-surface-2" onClick={() => patch({ assignedEmployeeId: null })}>
                <X size={12} />Unassign
              </button>
            )}
          </div>
        )}
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}
